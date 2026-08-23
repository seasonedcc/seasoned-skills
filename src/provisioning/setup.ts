import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { ProvisioningConfig, RepositoryResource } from '../config/types.js'
import {
  allocateCacheStoreIndex,
  cacheStoreIndexFromUrl,
  defaultDatabasePrefix,
  envKeyForPort,
  type LaneAllocation,
  laneDatabaseName,
  laneEnvValues,
  laneSlug,
  parseLaneAllocation,
  type ResolvedProvisioning,
  readEnvValues,
  repointLocalhostUrls,
  reservedPortsFromEnvFiles,
  resolvePortPlan,
  resolveProvisioning,
  seedRefusal,
  serviceEnvKey,
  serviceProbePort,
  upsertEnvValues,
  withCacheStoreIndex,
  withDatabaseName,
  worktreePathsFromPorcelain,
} from './common.js'
import {
  flushCacheStore,
  git,
  gitSucceeds,
  isPortFree,
  isPortListening,
  log,
  resolveMainRepository,
  runStep,
  waitForDatabaseServer,
  withAdminClient,
} from './runtime.js'
import {
  provisionDatabaseFromTemplate,
  type TemplateContext,
  templateFingerprint,
} from './template.js'

/**
 * Lane setup: create (or reuse) an isolated worktree of every declared
 * repository, allocate the lane's resources by deterministic hash of the lane
 * name, record them in the managed env block, and provision databases,
 * dependencies, and seed data from the resource table. Idempotent: the
 * managed block is the allocation record, so a re-run reuses the registered
 * worktree, its databases, its ports, and its cache-store index — and a
 * re-run never overwrites a lane's data, because seeding belongs only to
 * databases created in that same run.
 */

type ProvisionOptions = {
  /** Branch the lane's worktrees check out; defaults to `worktree/<lane>`. */
  branch?: string
  /** Base reference for a new branch; defaults to origin's HEAD branch. */
  base?: string
  /** Create the worktrees only — no services, databases, steps, or seed. */
  skipProvision?: boolean
  /** Provision without seeding. */
  skipSeed?: boolean
  /** Force the demo data to re-anchor to today (rebuilds a stale template). */
  freshSeed?: boolean
}

type LaneWorktree = {
  /** The repository's main checkout. */
  repositoryPath: string
  worktreePath: string
  branch: string
  repository: RepositoryResource
}

type ProvisionedDatabase = {
  name: string
  databaseName: string
  url: string
  created: boolean
}

type ProvisionResult = {
  lane: string
  slug: string
  worktrees: LaneWorktree[]
  primaryWorktreePath: string
  ports: Record<string, number>
  databases: ProvisionedDatabase[]
  cacheStoreUrl?: string
  seed: string
  summary: string
}

function defaultBaseReference(repositoryPath: string) {
  gitSucceeds(['fetch', 'origin'], { cwd: repositoryPath })
  if (
    gitSucceeds(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
      cwd: repositoryPath,
    })
  ) {
    return git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: repositoryPath,
    })
  }
  if (
    gitSucceeds(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'], {
      cwd: repositoryPath,
    })
  ) {
    return 'origin/main'
  }
  log(`could not resolve origin's HEAD for ${repositoryPath}; falling back to main`)
  return 'main'
}

function ensureWorktree({
  repositoryPath,
  worktreePath,
  branchName,
  baseReference,
}: {
  repositoryPath: string
  worktreePath: string
  branchName: string
  baseReference: string
}) {
  const registered = git(['worktree', 'list', '--porcelain'], { cwd: repositoryPath })
    .split('\n')
    .some((line) => line === `worktree ${worktreePath}`)
  if (registered) {
    log(`worktree already registered at ${worktreePath}`)
    return
  }
  if (existsSync(worktreePath)) {
    throw new Error(
      `${worktreePath} exists but is not a registered worktree; remove it or pick another lane name`,
    )
  }
  mkdirSync(dirname(worktreePath), { recursive: true })
  if (
    gitSucceeds(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`], {
      cwd: repositoryPath,
    })
  ) {
    git(['worktree', 'add', worktreePath, branchName], { cwd: repositoryPath })
    log(`created worktree at ${worktreePath} on existing branch ${branchName}`)
    return
  }
  git(['worktree', 'add', '-b', branchName, worktreePath, baseReference], {
    cwd: repositoryPath,
  })
  log(
    `created worktree at ${worktreePath} on new branch ${branchName} from ${baseReference}`,
  )
}

function worktreesRoot(repositoryPath: string) {
  return join(dirname(repositoryPath), `${basename(repositoryPath)}-worktrees`)
}

function laneWorktrees(
  mainRepository: string,
  resolved: ResolvedProvisioning,
  lane: string,
  branch: string,
): LaneWorktree[] {
  return resolved.repositories.map((repository) => {
    const repositoryPath = resolve(mainRepository, repository.path)
    return {
      repositoryPath,
      worktreePath: join(worktreesRoot(repositoryPath), lane),
      branch,
      repository,
    }
  })
}

function siblingEnvFileContents(
  mainRepository: string,
  currentWorktreePath: string,
  envFile: string,
) {
  const listing = git(['worktree', 'list', '--porcelain'], { cwd: mainRepository })
  return worktreePathsFromPorcelain(listing, currentWorktreePath).map((path) => {
    const envPath = join(path, envFile)
    return existsSync(envPath) ? readFileSync(envPath, 'utf8') : null
  })
}

/** The main checkout's URL for a database resource, with the primary as fallback. */
function mainDatabaseUrl(
  mainEnvValues: Record<string, string>,
  resolved: ResolvedProvisioning,
  envKey: string,
) {
  const primaryKey = resolved.databases[0]?.envKey
  const url =
    mainEnvValues[envKey] ?? (primaryKey ? mainEnvValues[primaryKey] : undefined)
  if (!url) {
    throw new Error(
      `the main checkout's ${resolved.envFile} carries no ${envKey}; provisioning needs it to derive lane database URLs`,
    )
  }
  return url
}

async function allocateLane({
  resolved,
  slug,
  mainEnvValues,
  siblingEnvFiles,
}: {
  resolved: ResolvedProvisioning
  slug: string
  mainEnvValues: Record<string, string>
  siblingEnvFiles: (string | null)[]
}) {
  const reserved = reservedPortsFromEnvFiles(
    siblingEnvFiles,
    resolved.portBases,
    resolved.portBlocks,
  )
  const ports = await resolvePortPlan(
    slug,
    resolved.portBases,
    resolved.portBlocks,
    reserved,
    isPortFree,
  )
  const databaseUrls: Record<string, string> = {}
  for (const database of resolved.databases) {
    databaseUrls[database.name] = withDatabaseName(
      mainDatabaseUrl(mainEnvValues, resolved, database.envKey),
      laneDatabaseName(resolved.databasePrefix, slug, database.name),
    )
  }
  const allocation: LaneAllocation = { ports, databaseUrls }
  let cacheIndexIsNew = false
  if (resolved.cacheStoreIndex) {
    const primaryKey = resolved.cacheStoreEnvKeys[0]
    const mainCacheUrl = primaryKey === undefined ? undefined : mainEnvValues[primaryKey]
    if (!mainCacheUrl) {
      throw new Error(
        `the main checkout's ${resolved.envFile} carries no ${primaryKey ?? 'cache-store URL'}; cacheStoreIndex needs it`,
      )
    }
    const taken = siblingEnvFiles.flatMap((contents) => {
      if (!contents || primaryKey === undefined) return []
      const url = readEnvValues(contents)[primaryKey]
      const index = url === undefined ? null : cacheStoreIndexFromUrl(url)
      return index === null ? [] : [index]
    })
    const index = allocateCacheStoreIndex(slug, taken)
    if (index === null) {
      throw new Error('no free cache-store index — tear down an unused lane first')
    }
    allocation.cacheStoreUrl = withCacheStoreIndex(mainCacheUrl, index)
    cacheIndexIsNew = true
  }
  return { allocation, cacheIndexIsNew }
}

async function startDeclaredServices(
  mainRepository: string,
  resolved: ResolvedProvisioning,
  mainEnvValues: Record<string, string>,
) {
  if (resolved.services.length === 0) return
  const toStart: string[] = []
  for (const service of resolved.services) {
    const url = mainEnvValues[serviceEnvKey(service)]
    if (!url) {
      log(
        `WARNING: no ${serviceEnvKey(service)} in the main checkout's env — not starting service "${service}"`,
      )
      continue
    }
    const port = serviceProbePort(url)
    if (port === null) {
      log(`cannot tell a port for service "${service}" (${url}); assuming it runs`)
      continue
    }
    if (await isPortListening(port)) continue
    toStart.push(service)
  }
  if (toStart.length === 0) return
  runStep(`${resolved.serviceStartCommand} ${toStart.join(' ')}`, {
    cwd: mainRepository,
  })
}

function writeLaneEnvFile({
  resolved,
  allocation,
  mainEnvContents,
  mainEnvValues,
  envPath,
}: {
  resolved: ResolvedProvisioning
  allocation: LaneAllocation
  mainEnvContents: string
  mainEnvValues: Record<string, string>
  envPath: string
}) {
  let contents = mainEnvContents
  for (const [name, port] of Object.entries(allocation.ports)) {
    const mainPort = Number(mainEnvValues[envKeyForPort(name)])
    contents = repointLocalhostUrls(contents, mainPort, port)
  }
  writeFileSync(envPath, upsertEnvValues(contents, laneEnvValues(allocation, resolved)))
  log(`wrote ${envPath} with the lane's allocation`)
}

function summaryText(result: Omit<ProvisionResult, 'summary'>) {
  const lines = [
    `Lane ${result.lane} ready`,
    ...result.worktrees.map(
      (worktree) => `  worktree:  ${worktree.worktreePath} (branch ${worktree.branch})`,
    ),
    ...Object.entries(result.ports).map(([name, port]) => `  ${name}: ${port}`),
    ...result.databases.map(
      (database) =>
        `  database ${database.name}: ${database.databaseName}${database.created ? ' (created)' : ''}`,
    ),
    ...(result.cacheStoreUrl ? [`  cache store: ${result.cacheStoreUrl}`] : []),
    `  seed: ${result.seed}`,
  ]
  return lines.join('\n')
}

async function provisionLane(
  projectRoot: string,
  config: ProvisioningConfig | undefined,
  lane: string,
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const mainRepository = resolveMainRepository(projectRoot)
  const resolved = resolveProvisioning(config, {
    databasePrefix: defaultDatabasePrefix(basename(mainRepository)),
  })
  const slug = laneSlug(lane)
  if (!slug) throw new Error(`cannot derive a slug from "${lane}"`)

  const branch = options.branch ?? `worktree/${lane}`
  const worktrees = laneWorktrees(mainRepository, resolved, lane, branch)
  for (const worktree of worktrees) {
    ensureWorktree({
      repositoryPath: worktree.repositoryPath,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branch,
      baseReference: options.base ?? defaultBaseReference(worktree.repositoryPath),
    })
  }
  const primary = worktrees[0]
  if (!primary) throw new Error('the resource table resolved to no repositories')

  const base: Omit<ProvisionResult, 'summary' | 'seed'> = {
    lane,
    slug,
    worktrees,
    primaryWorktreePath: primary.worktreePath,
    ports: {},
    databases: [],
  }
  if (options.skipProvision) {
    const seed = 'skipped (provisioning was skipped)'
    const summary = summaryText({ ...base, seed })
    log(`\n${summary}`)
    return { ...base, seed, summary }
  }

  const mainEnvPath = join(primary.repositoryPath, resolved.envFile)
  const mainEnvContents = existsSync(mainEnvPath) ? readFileSync(mainEnvPath, 'utf8') : ''
  const mainEnvValues = readEnvValues(mainEnvContents)

  await startDeclaredServices(primary.repositoryPath, resolved, mainEnvValues)

  const envPath = join(primary.worktreePath, resolved.envFile)
  const existingContents = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null
  const existing =
    existingContents === null ? null : parseLaneAllocation(existingContents, resolved)
  let allocation: LaneAllocation
  let cacheIndexIsNew = false
  if (existing) {
    log('env file already carries the managed block; keeping the existing allocation')
    allocation = existing
  } else {
    ;({ allocation, cacheIndexIsNew } = await allocateLane({
      resolved,
      slug,
      mainEnvValues,
      siblingEnvFiles: siblingEnvFileContents(
        primary.repositoryPath,
        primary.worktreePath,
        resolved.envFile,
      ),
    }))
    writeLaneEnvFile({
      resolved,
      allocation,
      mainEnvContents,
      mainEnvValues,
      envPath,
    })
  }

  // A freshly allocated index may have belonged to a lane that died without
  // teardown — flush before first use so its keys and queues cannot leak in.
  if (cacheIndexIsNew && allocation.cacheStoreUrl !== undefined) {
    flushCacheStore(allocation.cacheStoreUrl)
  }

  const stepEnv = laneEnvValues(allocation, resolved)
  for (const worktree of worktrees) {
    for (const step of worktree.repository.provisionSteps ?? []) {
      runStep(step, { cwd: worktree.worktreePath, env: stepEnv })
    }
  }

  const databases: ProvisionedDatabase[] = []
  let seed = 'not applicable (no databases declared)'
  if (resolved.databases.length > 0) {
    const migrateCommand = primary.repository.migrateCommand
    if (!migrateCommand) {
      throw new Error('the primary repository declares no migrateCommand')
    }
    const seedCommand = primary.repository.seedCommand
    const firstDatabase = resolved.databases[0]
    const adminUrl =
      firstDatabase === undefined
        ? undefined
        : allocation.databaseUrls[firstDatabase.name]
    if (adminUrl === undefined) throw new Error('no admin database URL resolved')
    await waitForDatabaseServer(adminUrl)
    await withAdminClient(adminUrl, async (client) => {
      for (const database of resolved.databases) {
        const url = allocation.databaseUrls[database.name]
        if (url === undefined) continue
        const databaseName = laneDatabaseName(
          resolved.databasePrefix,
          slug,
          database.name,
        )
        const existing = await client.query(
          'select 1 from pg_database where datname = $1',
          [databaseName],
        )
        const useTemplate =
          resolved.templateCaching && (!database.seeded || !options.skipSeed)
        const context: TemplateContext = {
          client,
          adminUrl: url,
          worktreePath: primary.worktreePath,
          resolved,
          database,
          migrateCommand,
          seedCommand,
          stepEnv,
        }
        if (existing.rowCount) {
          log(`database ${databaseName} already exists`)
          runStep(migrateCommand, {
            cwd: primary.worktreePath,
            env: { ...stepEnv, [database.envKey]: url },
          })
          databases.push({ name: database.name, databaseName, url, created: false })
          continue
        }
        if (useTemplate) {
          await provisionDatabaseFromTemplate(
            context,
            databaseName,
            templateFingerprint(primary.worktreePath, resolved, database),
            { freshSeed: options.freshSeed ?? false },
          )
        } else {
          await client.query(`create database "${databaseName}"`)
          runStep(migrateCommand, {
            cwd: primary.worktreePath,
            env: { ...stepEnv, [database.envKey]: url },
          })
        }
        log(`created database ${databaseName}`)
        databases.push({ name: database.name, databaseName, url, created: true })
      }
    })

    if (resolved.templateCaching) {
      seed = 'carried by the template copy'
    } else {
      const seededDatabases = resolved.databases.filter((database) => database.seeded)
      const created = new Set(
        databases.filter((database) => database.created).map((database) => database.name),
      )
      const refusal = seedRefusal({
        databasesAreNew:
          seededDatabases.length > 0 &&
          seededDatabases.every((database) => created.has(database.name)),
        seedRequested: !options.skipSeed,
        hasSeedCommand: Boolean(seedCommand),
      })
      if (refusal === null && seedCommand) {
        runStep(seedCommand, { cwd: primary.worktreePath, env: stepEnv })
        seed = 'seeded (reseed by tearing the lane down and setting it up again)'
      } else {
        log(`skipping the seed: ${refusal}`)
        seed = `skipped (${refusal})`
      }
    }
  }

  const withoutSummary = {
    ...base,
    ports: allocation.ports,
    databases,
    ...(allocation.cacheStoreUrl === undefined
      ? {}
      : { cacheStoreUrl: allocation.cacheStoreUrl }),
    seed,
  }
  const summary = summaryText(withoutSummary)
  log(`\n${summary}`)
  return { ...withoutSummary, summary }
}

export type { LaneWorktree, ProvisionedDatabase, ProvisionOptions, ProvisionResult }
export {
  defaultBaseReference,
  ensureWorktree,
  laneWorktrees,
  provisionLane,
  worktreesRoot,
}
