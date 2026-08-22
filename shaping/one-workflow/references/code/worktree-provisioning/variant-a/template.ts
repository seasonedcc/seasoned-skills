import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type pg from 'pg'
import {
  APP_ENV_FILE,
  BUILDING_DATABASE_NAMES,
  fingerprintSources,
  hasStaleSeedDate,
  parseTemplateFingerprint,
  planTemplateUsage,
  readEnvValues,
  TEMPLATE_DATABASE_NAMES,
  type TemplateFingerprint,
  type TemplateKind,
  todaysSeedDate,
  withDatabaseName,
} from './common'
import {
  git,
  log,
  resolveMainRepository,
  runStep,
  withAdminClient,
} from './runtime'

const MIGRATION_SOURCE_PATHS = [
  'apps/web/app/db/migrations',
  'apps/web/app/db/migrate.ts',
  'apps/web/app/db/scripts/migrate.ts',
]

const SEED_SOURCE_PATHS = [
  'apps/web/app/db/prod-seed',
  'apps/web/app/db/dev-seed',
]

const TEMPLATE_LOCK_KEY = 'app worktree template databases'
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

function templateFingerprints(worktreePath: string) {
  const migrationsHash = fingerprintSources(
    collectSources(worktreePath, MIGRATION_SOURCE_PATHS)
  )
  const seedHash = fingerprintSources(
    collectSources(worktreePath, SEED_SOURCE_PATHS)
  )
  return {
    development: { migrationsHash, seedHash, seedDate: todaysSeedDate() },
    test: { migrationsHash },
  }
}

async function readTemplateFingerprint(
  client: pg.Client,
  databaseName: string
) {
  const result = await client.query<{ fingerprint: string | null }>(
    `select shobj_description(oid, 'pg_database') as fingerprint
     from pg_database
     where datname = $1`,
    [databaseName]
  )
  return parseTemplateFingerprint(result.rows[0]?.fingerprint)
}

async function writeTemplateFingerprint(
  client: pg.Client,
  databaseName: string,
  fingerprint: TemplateFingerprint
) {
  const comment = JSON.stringify(fingerprint).replaceAll("'", "''")
  await client.query(`comment on database "${databaseName}" is '${comment}'`)
}

async function terminateConnections(client: pg.Client, databaseName: string) {
  await client.query(
    `select pg_terminate_backend(pid)
     from pg_stat_activity
     where datname = $1 and pid <> pg_backend_pid()`,
    [databaseName]
  )
}

async function dropDatabase(client: pg.Client, databaseName: string) {
  await terminateConnections(client, databaseName)
  await client.query(`drop database if exists "${databaseName}"`)
}

function migrateAndSeed({
  kind,
  worktreePath,
  databaseUrl,
}: {
  kind: TemplateKind
  worktreePath: string
  databaseUrl: string
}) {
  runStep('pnpm', ['run', 'db:migrate:production'], {
    cwd: worktreePath,
    env: { DATABASE_URL: databaseUrl },
  })
  if (kind === 'development') {
    runStep('pnpm', ['run', 'db:seed:dev'], {
      cwd: worktreePath,
      env: { DATABASE_URL: databaseUrl },
    })
  }
}

async function buildTemplate({
  client,
  adminUrl,
  worktreePath,
  kind,
  fingerprint,
}: {
  client: pg.Client
  adminUrl: string
  worktreePath: string
  kind: TemplateKind
  fingerprint: TemplateFingerprint
}) {
  const buildingName = BUILDING_DATABASE_NAMES[kind]
  const templateName = TEMPLATE_DATABASE_NAMES[kind]
  log(`building the ${templateName} template`)
  await dropDatabase(client, buildingName)
  await client.query(`create database "${buildingName}"`)
  migrateAndSeed({
    kind,
    worktreePath,
    databaseUrl: withDatabaseName(adminUrl, buildingName),
  })
  await dropDatabase(client, templateName)
  await terminateConnections(client, buildingName)
  await client.query(
    `alter database "${buildingName}" rename to "${templateName}"`
  )
  await writeTemplateFingerprint(client, templateName, fingerprint)
  log(`${templateName} is ready`)
}

async function ensureTemplate({
  client,
  adminUrl,
  worktreePath,
  kind,
  fingerprint,
  freshSeed,
  force = false,
}: {
  client: pg.Client
  adminUrl: string
  worktreePath: string
  kind: TemplateKind
  fingerprint: TemplateFingerprint
  freshSeed: boolean
  force?: boolean
}) {
  await client.query('select pg_advisory_lock(hashtext($1))', [
    TEMPLATE_LOCK_KEY,
  ])
  try {
    const stored = await readTemplateFingerprint(
      client,
      TEMPLATE_DATABASE_NAMES[kind]
    )
    const plan = planTemplateUsage(stored, fingerprint, { freshSeed })
    if (plan.action !== 'rebuild' && !force) {
      log(`${TEMPLATE_DATABASE_NAMES[kind]} needs no rebuild`)
      return plan.action
    }
    await buildTemplate({ client, adminUrl, worktreePath, kind, fingerprint })
    return 'copy' as const
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [
      TEMPLATE_LOCK_KEY,
    ])
  }
}

async function copyTemplate(
  client: pg.Client,
  templateName: string,
  databaseName: string
) {
  for (let attempt = 1; attempt <= COPY_ATTEMPTS; attempt += 1) {
    try {
      await client.query(
        `create database "${databaseName}" template "${templateName}"`
      )
      return
    } catch (error) {
      if (attempt === COPY_ATTEMPTS) throw error
      log(
        `copying ${templateName} failed (${(error as Error).message}); retrying`
      )
      await new Promise((resolve) =>
        setTimeout(resolve, COPY_RETRY_MILLISECONDS)
      )
    }
  }
}

async function provisionDatabaseFromTemplate({
  client,
  adminUrl,
  worktreePath,
  databaseName,
  kind,
  fingerprint,
  freshSeed,
  prepareWorktree,
}: {
  client: pg.Client
  adminUrl: string
  worktreePath: string
  databaseName: string
  kind: TemplateKind
  fingerprint: TemplateFingerprint
  freshSeed: boolean
  prepareWorktree: () => Promise<void>
}) {
  const templateName = TEMPLATE_DATABASE_NAMES[kind]
  const stored = await readTemplateFingerprint(client, templateName)
  const plan = planTemplateUsage(stored, fingerprint, { freshSeed })
  log(`${databaseName}: ${plan.reason}`)

  let action: 'copy' | 'migrate' = 'copy'
  if (plan.action === 'rebuild') {
    await prepareWorktree()
    action = await ensureTemplate({
      client,
      adminUrl,
      worktreePath,
      kind,
      fingerprint,
      freshSeed,
    })
  } else {
    action = plan.action
    if (hasStaleSeedDate(stored, fingerprint)) {
      log(
        `${templateName} was seeded on another day, so its demo data no longer lands on today — run pnpm run worktree:template to refresh it`
      )
    }
  }

  await copyTemplate(client, templateName, databaseName)
  if (action === 'copy') return

  await prepareWorktree()
  try {
    runStep('pnpm', ['run', 'db:migrate:production'], {
      cwd: worktreePath,
      env: { DATABASE_URL: withDatabaseName(adminUrl, databaseName) },
    })
  } catch (error) {
    log(
      `could not migrate the copy of ${templateName} forward (${(error as Error).message}); building ${databaseName} from scratch instead`
    )
    await dropDatabase(client, databaseName)
    await client.query(`create database "${databaseName}"`)
    migrateAndSeed({
      kind,
      worktreePath,
      databaseUrl: withDatabaseName(adminUrl, databaseName),
    })
  }
}

function databaseUrlFrom(checkout: string) {
  const envPath = join(checkout, APP_ENV_FILE)
  if (!existsSync(envPath)) return null
  return readEnvValues(readFileSync(envPath, 'utf8')).DATABASE_URL ?? null
}

async function main() {
  const { values } = parseArgs({
    options: { force: { type: 'boolean', default: false } },
  })
  const checkout = git(['rev-parse', '--show-toplevel'])
  const adminUrl =
    databaseUrlFrom(checkout) ?? databaseUrlFrom(resolveMainRepository())
  if (!adminUrl) {
    throw new Error(
      `DATABASE_URL is missing from ${join(checkout, APP_ENV_FILE)}`
    )
  }
  const fingerprints = templateFingerprints(checkout)

  await withAdminClient(adminUrl, async (client) => {
    for (const kind of ['development', 'test'] as const) {
      const stored = await readTemplateFingerprint(
        client,
        TEMPLATE_DATABASE_NAMES[kind]
      )
      const plan = planTemplateUsage(stored, fingerprints[kind], {
        freshSeed: true,
      })
      log(`${TEMPLATE_DATABASE_NAMES[kind]}: ${plan.reason}`)
      await ensureTemplate({
        client,
        adminUrl,
        worktreePath: checkout,
        kind,
        fingerprint: fingerprints[kind],
        freshSeed: true,
        force: values.force || plan.action !== 'copy',
      })
    }
  })

  console.log(
    `Templates ready: ${TEMPLATE_DATABASE_NAMES.development} and ${TEMPLATE_DATABASE_NAMES.test}`
  )
}

const runDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (runDirectly) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export { provisionDatabaseFromTemplate, templateFingerprints }
