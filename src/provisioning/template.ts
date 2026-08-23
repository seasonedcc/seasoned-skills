import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type pg from 'pg'
import {
  buildingTemplateDatabaseName,
  fingerprintSources,
  hasStaleSeedDate,
  parseTemplateFingerprint,
  planTemplateUsage,
  type ResolvedDatabase,
  type ResolvedProvisioning,
  type TemplateFingerprint,
  templateDatabaseName,
  todaysSeedDate,
  withDatabaseName,
} from './common.js'
import { log, runStep } from './runtime.js'

/**
 * Template-database caching: the expensive migrate-and-seed result is kept as
 * a template database whose fingerprint — content hashes of the migration
 * and seed sources plus the date the seed ran — is stored on the database
 * itself (`comment on database`). A lane copies the template in about a
 * second; a changed source or a stale seed date rebuilds it transparently,
 * and the fresh-seed flag forces the demo data to re-anchor to today.
 */

const COPY_ATTEMPTS = 3
const COPY_RETRY_MILLISECONDS = 2000

function* sourceFiles(path: string): Generator<string> {
  if (!existsSync(path)) return
  if (!statSync(path).isDirectory()) {
    yield path
    return
  }
  for (const entry of readdirSync(path).sort()) {
    yield* sourceFiles(join(path, entry))
  }
}

function collectSources(worktreePath: string, relativePaths: string[]) {
  const sources: [string, string][] = []
  for (const relativePath of relativePaths) {
    for (const file of sourceFiles(join(worktreePath, relativePath))) {
      if (file.endsWith('.test.ts')) continue
      sources.push([relative(worktreePath, file), readFileSync(file, 'utf8')])
    }
  }
  return sources
}

/**
 * The current fingerprint for one database resource: migrations always, seed
 * hash and date only for a seeded resource — the fingerprint of a
 * migrate-only template never goes stale on the calendar.
 */
function templateFingerprint(
  worktreePath: string,
  resolved: ResolvedProvisioning,
  database: ResolvedDatabase,
): TemplateFingerprint {
  const migrationsHash = fingerprintSources(
    collectSources(worktreePath, resolved.migrationSources),
  )
  if (!database.seeded) return { migrationsHash }
  return {
    migrationsHash,
    seedHash: fingerprintSources(collectSources(worktreePath, resolved.seedSources)),
    seedDate: todaysSeedDate(new Date(), resolved.seedDateTimezone),
  }
}

async function readTemplateFingerprint(client: pg.Client, databaseName: string) {
  const result = await client.query<{ fingerprint: string | null }>(
    `select shobj_description(oid, 'pg_database') as fingerprint
     from pg_database
     where datname = $1`,
    [databaseName],
  )
  return parseTemplateFingerprint(result.rows[0]?.fingerprint)
}

async function writeTemplateFingerprint(
  client: pg.Client,
  databaseName: string,
  fingerprint: TemplateFingerprint,
) {
  const comment = JSON.stringify(fingerprint).replaceAll("'", "''")
  await client.query(`comment on database "${databaseName}" is '${comment}'`)
}

async function terminateConnections(client: pg.Client, databaseName: string) {
  await client.query(
    `select pg_terminate_backend(pid)
     from pg_stat_activity
     where datname = $1 and pid <> pg_backend_pid()`,
    [databaseName],
  )
}

async function dropDatabase(client: pg.Client, databaseName: string) {
  await terminateConnections(client, databaseName)
  await client.query(`drop database if exists "${databaseName}"`)
}

type TemplateContext = {
  client: pg.Client
  adminUrl: string
  worktreePath: string
  resolved: ResolvedProvisioning
  database: ResolvedDatabase
  /** The primary repository's migrate command. */
  migrateCommand: string
  /** The primary repository's seed command, when the resource is seeded. */
  seedCommand: string | undefined
  /** The lane's full allocation values, handed to every step's environment. */
  stepEnv: Record<string, string>
}

function migrateAndSeed(context: TemplateContext, databaseUrl: string) {
  const env = { ...context.stepEnv, [context.database.envKey]: databaseUrl }
  runStep(context.migrateCommand, { cwd: context.worktreePath, env })
  if (context.database.seeded && context.seedCommand) {
    runStep(context.seedCommand, { cwd: context.worktreePath, env })
  }
}

async function buildTemplate(context: TemplateContext, fingerprint: TemplateFingerprint) {
  const { client, adminUrl, resolved, database } = context
  const buildingName = buildingTemplateDatabaseName(
    resolved.databasePrefix,
    database.name,
  )
  const templateName = templateDatabaseName(resolved.databasePrefix, database.name)
  log(`building the ${templateName} template`)
  await dropDatabase(client, buildingName)
  await client.query(`create database "${buildingName}"`)
  migrateAndSeed(context, withDatabaseName(adminUrl, buildingName))
  await dropDatabase(client, templateName)
  await terminateConnections(client, buildingName)
  await client.query(`alter database "${buildingName}" rename to "${templateName}"`)
  await writeTemplateFingerprint(client, templateName, fingerprint)
  log(`${templateName} is ready`)
}

async function ensureTemplate(
  context: TemplateContext,
  fingerprint: TemplateFingerprint,
  { freshSeed = false, force = false } = {},
) {
  const { client, resolved, database } = context
  const templateName = templateDatabaseName(resolved.databasePrefix, database.name)
  const lockKey = `${resolved.databasePrefix} worktree template databases`
  await client.query('select pg_advisory_lock(hashtext($1))', [lockKey])
  try {
    const stored = await readTemplateFingerprint(client, templateName)
    const plan = planTemplateUsage(stored, fingerprint, { freshSeed })
    if (plan.action !== 'rebuild' && !force) {
      log(`${templateName} needs no rebuild`)
      return plan.action
    }
    await buildTemplate(context, fingerprint)
    return 'copy' as const
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [lockKey])
  }
}

async function copyTemplate(
  client: pg.Client,
  templateName: string,
  databaseName: string,
) {
  for (let attempt = 1; attempt <= COPY_ATTEMPTS; attempt += 1) {
    try {
      await client.query(`create database "${databaseName}" template "${templateName}"`)
      return
    } catch (error) {
      if (attempt === COPY_ATTEMPTS) throw error
      log(`copying ${templateName} failed (${(error as Error).message}); retrying`)
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, COPY_RETRY_MILLISECONDS),
      )
    }
  }
}

/**
 * Provision one lane database from its template: copy when the template is
 * current, migrate the copy forward when only the migrations moved, rebuild
 * the template first when the seed or its date demands it. Falls back to
 * building the lane database from scratch when the copy cannot be migrated.
 */
async function provisionDatabaseFromTemplate(
  context: TemplateContext,
  databaseName: string,
  fingerprint: TemplateFingerprint,
  { freshSeed = false } = {},
) {
  const { client, adminUrl, resolved, database } = context
  const templateName = templateDatabaseName(resolved.databasePrefix, database.name)
  const stored = await readTemplateFingerprint(client, templateName)
  const plan = planTemplateUsage(stored, fingerprint, { freshSeed })
  log(`${databaseName}: ${plan.reason}`)

  let action: 'copy' | 'migrate' = 'copy'
  if (plan.action === 'rebuild') {
    action = await ensureTemplate(context, fingerprint, { freshSeed })
  } else {
    action = plan.action
    if (hasStaleSeedDate(stored, fingerprint)) {
      log(
        `${templateName} was seeded on another day, so its demo data no longer lands on today — re-run with the fresh-seed flag to re-anchor it`,
      )
    }
  }

  await copyTemplate(client, templateName, databaseName)
  if (action === 'copy') return

  try {
    runStep(context.migrateCommand, {
      cwd: context.worktreePath,
      env: {
        ...context.stepEnv,
        [database.envKey]: withDatabaseName(adminUrl, databaseName),
      },
    })
  } catch (error) {
    log(
      `could not migrate the copy of ${templateName} forward (${(error as Error).message}); building ${databaseName} from scratch instead`,
    )
    await dropDatabase(client, databaseName)
    await client.query(`create database "${databaseName}"`)
    migrateAndSeed(context, withDatabaseName(adminUrl, databaseName))
  }
}

export type { TemplateContext }
export {
  collectSources,
  ensureTemplate,
  provisionDatabaseFromTemplate,
  readTemplateFingerprint,
  templateFingerprint,
  writeTemplateFingerprint,
}
