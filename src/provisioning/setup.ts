import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type pg from 'pg'
import { CONFIG_FILE_NAME } from '../config/load.js'
import type { ProvisioningConfig } from '../config/types.js'
import {
  allocateCacheStoreIndex,
  cacheStoreIndexFromUrl,
  defaultDatabasePrefix,
  ENV_MARKER,
  type LaneAllocation,
  laneDatabaseName,
  laneEnvValuesForFile,
  laneResourcePool,
  laneSlug,
  mergedLaneEnvValues,
  type PortPlan,
  parseLaneAllocationFromFiles,
  portsHeldBy,
  type ResolvedDatabase,
  type ResolvedEnvFile,
  type ResolvedProvisioning,
  type ResolvedRepository,
  readEnvValues,
  repointLocalhostUrls,
  reservedPortsFromLaneEnvFiles,
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
 * Lane setup: create (or reuse) an isolated worktree of every selected
 * repository, allocate the lane's resources by deterministic hash of the lane
 * name, record them in each repository's managed env block, and provision
 * databases, dependencies, and seed data from what that repository declares.
 * Ports and the cache-store index are pooled lane-wide — a lane holds one set,
 * read back from every declared repository and not only the ones a run covers
 * — while every other resource is anchored to the repository that owns it.
 * Idempotent: the managed block is the allocation record, so a re-run reuses
 * the registered worktrees, their databases, their ports, and the lane's
 * cache-store index — and a re-run never overwrites a lane's data, because
 * seeding belongs only to databases created in that same run.
 */

type ProvisionOptions = {
  /** Declared repository paths this run covers; defaults to the first declared entry. */
  repositoryPaths?: string[]
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
  repository: ResolvedRepository
}

type ProvisionedDatabase = {
  name: string
  databaseName: string
  url: string
  created: boolean
}

type ProvisionedRepository = {
  worktree: LaneWorktree
  databases: ProvisionedDatabase[]
  cacheStoreUrl?: string
  seed: string
}

type ProvisionResult = {
  lane: string
  slug: string
  /** The lane's pooled ports, across every repository this run covered. */
  ports: PortPlan
  repositories: ProvisionedRepository[]
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
  const localBranchExists = gitSucceeds(
    ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`],
    { cwd: repositoryPath },
  )
  const originBranch = `origin/${branchName}`
  const originBranchExists = gitSucceeds(
    ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branchName}`],
    { cwd: repositoryPath },
  )
  if (localBranchExists) {
    if (originBranchExists && localBranchIsStrictlyBehind(repositoryPath, branchName)) {
      git(['branch', '--force', branchName, originBranch], { cwd: repositoryPath })
      log(`fast-forwarded stale local branch ${branchName} to ${originBranch}`)
    }
    git(['worktree', 'add', worktreePath, branchName], { cwd: repositoryPath })
    log(`created worktree at ${worktreePath} on existing branch ${branchName}`)
    return
  }
  if (originBranchExists) {
    git(['branch', '--no-track', branchName, originBranch], { cwd: repositoryPath })
    git(['worktree', 'add', worktreePath, branchName], { cwd: repositoryPath })
    log(
      `created worktree at ${worktreePath} on branch ${branchName} adopted from ${originBranch}`,
    )
    return
  }
  git(['worktree', 'add', '--no-track', '-b', branchName, worktreePath, baseReference], {
    cwd: repositoryPath,
  })
  log(
    `created worktree at ${worktreePath} on new branch ${branchName} from ${baseReference}`,
  )
}

function localBranchIsStrictlyBehind(repositoryPath: string, branchName: string) {
  const localTip = git(['rev-parse', `refs/heads/${branchName}`], {
    cwd: repositoryPath,
  })
  const originTip = git(['rev-parse', `refs/remotes/origin/${branchName}`], {
    cwd: repositoryPath,
  })
  if (localTip === originTip) return false
  return gitSucceeds(['merge-base', '--is-ancestor', localTip, originTip], {
    cwd: repositoryPath,
  })
}

function worktreesRoot(repositoryPath: string) {
  return join(dirname(repositoryPath), `${basename(repositoryPath)}-worktrees`)
}

function laneWorktrees(
  mainRepository: string,
  repositories: ResolvedRepository[],
  lane: string,
  branch: string,
): LaneWorktree[] {
  return repositories.map((repository) => {
    const repositoryPath = resolve(mainRepository, repository.path)
    return {
      repositoryPath,
      worktreePath: join(worktreesRoot(repositoryPath), lane),
      branch,
      repository,
    }
  })
}

/**
 * The repositories one provisioning run covers. Each requested path must match
 * a declared entry exactly; with none requested the run covers the first
 * declared entry alone, so declaration order is a default and never resource
 * semantics.
 */
function selectRepositories(
  resolved: ResolvedProvisioning,
  requestedPaths: string[] | undefined,
): ResolvedRepository[] {
  const declaredPaths = resolved.repositories.map((repository) => repository.path)
  if (requestedPaths === undefined || requestedPaths.length === 0) {
    const [first] = resolved.repositories
    if (!first) throw new Error('the resource table resolved to no repositories')
    return [first]
  }
  const selected: ResolvedRepository[] = []
  for (const path of requestedPaths) {
    const repository = resolved.repositories.find((candidate) => candidate.path === path)
    if (!repository) {
      throw new Error(
        `--repo ${path} matches no repository declared in ${CONFIG_FILE_NAME}; it declares ${declaredPaths.map((declared) => `"${declared}"`).join(', ')}`,
      )
    }
    if (!selected.includes(repository)) selected.push(repository)
  }
  return selected
}

/** One declared env file with the main checkout's contents at its path. */
type MainEnvFile = {
  file: ResolvedEnvFile
  contents: string
  values: Record<string, string>
}

function readMainEnvFiles(repositoryPath: string, repository: ResolvedRepository) {
  return repository.envFiles.map((file): MainEnvFile => {
    const path = join(repositoryPath, file.path)
    const contents = existsSync(path) ? readFileSync(path, 'utf8') : ''
    return { file, contents, values: readEnvValues(contents) }
  })
}

/** Main env values merged across the declared files; the first file wins. */
function mergedMainEnvValues(mainFiles: MainEnvFile[]) {
  const merged: Record<string, string> = {}
  for (const { values } of mainFiles) {
    for (const [key, value] of Object.entries(values)) {
      if (!(key in merged)) merged[key] = value
    }
  }
  return merged
}

/**
 * Every declared env file of every sibling worktree of one repository (its
 * main checkout included), one contents entry per declared file, in
 * declaration order.
 */
function siblingLaneEnvFileContents(
  repositoryPath: string,
  currentWorktreePath: string,
  envFiles: ResolvedEnvFile[],
) {
  const listing = git(['worktree', 'list', '--porcelain'], { cwd: repositoryPath })
  return worktreePathsFromPorcelain(listing, currentWorktreePath).map((path) =>
    envFiles.map((file) => {
      const envPath = join(path, file.path)
      return existsSync(envPath) ? readFileSync(envPath, 'utf8') : null
    }),
  )
}

/**
 * The main checkout's URL a lane database is derived from: read under the
 * database's env key from the files that carry that database — the same key
 * name may point at a different database in another file — falling back to
 * the repository's first database key within those same files.
 */
function mainDatabaseUrl(
  mainFiles: MainEnvFile[],
  repository: ResolvedRepository,
  database: ResolvedDatabase,
) {
  const carrying = mainFiles.filter(({ file }) =>
    file.databases.some((candidate) => candidate.name === database.name),
  )
  const firstKey = repository.databases[0]?.envKey
  const url =
    carrying.map(({ values }) => values[database.envKey]).find(Boolean) ??
    (firstKey === undefined
      ? undefined
      : carrying.map(({ values }) => values[firstKey]).find(Boolean))
  if (!url) {
    const where = carrying[0]?.file.path ?? repository.envFile
    throw new Error(
      `the main checkout's ${where} carries no ${database.envKey}; provisioning needs it to derive lane database URLs`,
    )
  }
  return url
}

/**
 * What one repository already holds before anything is assigned: its main
 * checkout's env files, this lane's own, the allocation they record, and every
 * sibling lane's — the claims a fresh allocation has to steer around.
 */
type RepositoryLaneState = {
  worktree: LaneWorktree
  mainFiles: MainEnvFile[]
  laneFileContents: (string | null)[]
  siblingFileContents: (string | null)[][]
  existing: LaneAllocation | null
}

function readRepositoryLaneState(worktree: LaneWorktree): RepositoryLaneState {
  const { repository } = worktree
  const laneFileContents = repository.envFiles.map((file) => {
    const envPath = join(worktree.worktreePath, file.path)
    return existsSync(envPath) ? readFileSync(envPath, 'utf8') : null
  })
  return {
    worktree,
    mainFiles: readMainEnvFiles(worktree.repositoryPath, repository),
    laneFileContents,
    siblingFileContents: siblingLaneEnvFileContents(
      worktree.repositoryPath,
      worktree.worktreePath,
      repository.envFiles,
    ),
    existing: parseLaneAllocationFromFiles(laneFileContents, repository),
  }
}

/**
 * What the lane already holds in every declared repository whose main checkout
 * is on this machine, in declaration order. Ports and the cache-store index
 * are lane-wide, so an allocation recorded in a repository this run leaves out
 * is still the lane's, and the sibling lanes recorded there still hold theirs.
 * A declared repository nobody cloned is left out with a log line: provisioning
 * a selection must not die because an unrelated sibling is absent.
 */
function readTableLaneStates(
  mainRepository: string,
  resolved: ResolvedProvisioning,
  lane: string,
  branch: string,
) {
  const worktrees = laneWorktrees(mainRepository, resolved.repositories, lane, branch)
  return worktrees.flatMap((worktree) => {
    if (existsSync(worktree.repositoryPath)) return [readRepositoryLaneState(worktree)]
    log(
      `no checkout at ${worktree.repositoryPath}; leaving "${worktree.repository.path}" out of the lane's allocation`,
    )
    return []
  })
}

/**
 * The lane's port plan: whatever the covered repositories already record
 * stands, and only the names no marked env file carries yet are assigned — so
 * adding a repository to a live lane never moves the ports its siblings are
 * already serving on. A port name is unique only within a selection, so a name
 * an uncovered repository records is never reused by name; that repository's
 * whole recorded blocks are reserved instead, alongside every sibling lane's
 * across the whole table.
 */
async function resolveLanePorts(
  slug: string,
  pool: { portBases: Record<string, number>; portBlocks: Record<string, number> },
  states: RepositoryLaneState[],
  uncoveredStates: RepositoryLaneState[],
) {
  const recorded: PortPlan = {}
  for (const state of states) {
    for (const [name, port] of Object.entries(state.existing?.ports ?? {})) {
      recorded[name] = port
    }
  }
  const unassigned = Object.fromEntries(
    Object.entries(pool.portBases).filter(([name]) => recorded[name] === undefined),
  )
  if (Object.keys(unassigned).length === 0) return recorded
  const reserved = new Set<number>(
    Object.entries(recorded).flatMap(([name, port]) =>
      portsHeldBy(name, port, pool.portBlocks),
    ),
  )
  for (const state of uncoveredStates) {
    const { portBlocks } = state.worktree.repository
    for (const [name, port] of Object.entries(state.existing?.ports ?? {})) {
      for (const held of portsHeldBy(name, port, portBlocks)) reserved.add(held)
    }
  }
  for (const state of [...states, ...uncoveredStates]) {
    const sibling = reservedPortsFromLaneEnvFiles(
      state.siblingFileContents,
      state.worktree.repository,
    )
    for (const port of sibling) reserved.add(port)
  }
  const assigned = await resolvePortPlan(
    slug,
    unassigned,
    pool.portBlocks,
    reserved,
    isPortFree,
  )
  return { ...recorded, ...assigned }
}

/**
 * The lane's cache-store index — one per lane, shared by every repository that
 * asks for one. The index a lane already records in any declared repository is
 * kept, whether or not this run covers that repository; a fresh one is
 * allocated against the indexes sibling lanes claim across the whole table, and
 * flushed before first use, since a recycled index carries the previous
 * tenant's keys.
 */
function resolveLaneCacheStoreIndex(
  slug: string,
  states: RepositoryLaneState[],
  uncoveredStates: RepositoryLaneState[],
) {
  if (!states.some((state) => state.worktree.repository.cacheStoreIndex)) return null
  const declaring = [...states, ...uncoveredStates].filter(
    (state) => state.worktree.repository.cacheStoreIndex,
  )
  const recorded = declaring
    .map((state) => state.existing?.cacheStoreUrl)
    .filter((url): url is string => url !== undefined)
    .map(cacheStoreIndexFromUrl)
    .find((index): index is number => index !== null)
  if (recorded !== undefined) return { index: recorded, isNew: false }
  const taken = declaring.flatMap((state) => {
    const key = state.worktree.repository.cacheStoreEnvKeys[0]
    if (key === undefined) return []
    return state.siblingFileContents.flat().flatMap((contents) => {
      const url = contents === null ? undefined : readEnvValues(contents)[key]
      const index = url === undefined ? null : cacheStoreIndexFromUrl(url)
      return index === null ? [] : [index]
    })
  })
  const index = allocateCacheStoreIndex(slug, taken)
  if (index === null) {
    throw new Error('no free cache-store index — tear down an unused lane first')
  }
  return { index, isNew: true }
}

/** The cache-store URL one repository records: its own base URL, the lane's index. */
function repositoryCacheStoreUrl(state: RepositoryLaneState, index: number) {
  const { repository } = state.worktree
  const recorded = state.existing?.cacheStoreUrl
  if (recorded !== undefined) return recorded
  const key = repository.cacheStoreEnvKeys[0]
  const cacheFile = state.mainFiles.find(({ file }) => file.cacheStore)
  const mainCacheUrl = key === undefined ? undefined : cacheFile?.values[key]
  if (!mainCacheUrl) {
    throw new Error(
      `the main checkout's ${cacheFile?.file.path ?? repository.envFile} carries no ${key ?? 'cache-store URL'}; cacheStoreIndex needs it`,
    )
  }
  return withCacheStoreIndex(mainCacheUrl, index)
}

/** One repository's slice of the lane: its ports, its databases, its cache-store URL. */
function repositoryAllocation(
  state: RepositoryLaneState,
  ports: PortPlan,
  cacheStoreIndex: { index: number; isNew: boolean } | null,
  slug: string,
  databasePrefix: string,
): LaneAllocation {
  const { repository } = state.worktree
  const databaseUrls: Record<string, string> = {}
  for (const database of repository.databases) {
    databaseUrls[database.name] =
      state.existing?.databaseUrls[database.name] ??
      withDatabaseName(
        mainDatabaseUrl(state.mainFiles, repository, database),
        laneDatabaseName(databasePrefix, slug, database.name),
      )
  }
  const allocation: LaneAllocation = { ports, databaseUrls }
  if (repository.cacheStoreIndex && cacheStoreIndex !== null) {
    allocation.cacheStoreUrl = repositoryCacheStoreUrl(state, cacheStoreIndex.index)
  }
  return allocation
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

/**
 * Write one repository's lane env files. Each seeds from that repository's
 * main checkout at the same relative path, repoints localhost URLs using its
 * own port entries (the main file's value for each managed key is the
 * from-port), and upserts its slice of the managed allocation block. `only`
 * limits the write to the named paths — used to restore files missing from a
 * partial lane.
 */
function writeLaneEnvFiles({
  repository,
  allocation,
  slug,
  mainFiles,
  worktreePath,
  only,
}: {
  repository: ResolvedRepository
  allocation: LaneAllocation
  slug: string
  mainFiles: MainEnvFile[]
  worktreePath: string
  only?: ReadonlySet<string>
}) {
  for (const { file, contents: mainContents, values: mainValues } of mainFiles) {
    if (only && !only.has(file.path)) continue
    let contents = mainContents
    for (const [envKey, portName] of Object.entries(file.ports)) {
      const port = allocation.ports[portName]
      if (port === undefined) continue
      contents = repointLocalhostUrls(contents, Number(mainValues[envKey]), port)
    }
    const envPath = join(worktreePath, file.path)
    mkdirSync(dirname(envPath), { recursive: true })
    writeFileSync(
      envPath,
      upsertEnvValues(contents, laneEnvValuesForFile(allocation, repository, file, slug)),
    )
    log(`wrote ${envPath} with the lane's allocation`)
  }
}

/**
 * Write one repository's lane env files: all of them for a fresh lane
 * worktree, and for a lane that already records the managed block only the
 * declared files that lost theirs — restored from the allocation the marked
 * files still record.
 */
function writeRepositoryLaneEnvFiles(
  state: RepositoryLaneState,
  allocation: LaneAllocation,
  slug: string,
) {
  const { repository, worktreePath } = state.worktree
  const target = {
    repository,
    allocation,
    slug,
    mainFiles: state.mainFiles,
    worktreePath,
  }
  if (!state.existing) {
    writeLaneEnvFiles(target)
    return
  }
  log(
    `${repository.path}: the env files already carry the managed block; keeping the existing allocation`,
  )
  const missing = new Set(
    repository.envFiles
      .filter((_, index) => !state.laneFileContents[index]?.includes(ENV_MARKER))
      .map((file) => file.path),
  )
  if (missing.size > 0) writeLaneEnvFiles({ ...target, only: missing })
}

/**
 * Flush every cache-store database the lane has just claimed, once each, before
 * the first provision step of any repository runs. A freshly allocated index
 * may have belonged to a lane that died without teardown, and its keys and
 * queue backlogs would leak into this one; two repositories sharing the lane's
 * index share one database, so a flush per repository would wipe what the
 * first one's steps and seed already wrote.
 */
function flushNewCacheStoreDatabases(allocations: LaneAllocation[]) {
  const urls = new Set(
    allocations
      .map((allocation) => allocation.cacheStoreUrl)
      .filter((url): url is string => url !== undefined),
  )
  for (const url of urls) flushCacheStore(url)
}

/**
 * Create every missing plain database before any migration runs: a project's
 * migrateCommand may migrate all of its databases in one invocation, so each
 * database it touches must already exist. Template-provisioned databases are
 * not pre-created — the template copy creates them itself.
 */
async function provisionLaneDatabases({
  client,
  resolved,
  repository,
  allocation,
  slug,
  worktreePath,
  migrateCommand,
  seedCommand,
  stepEnv,
  options,
}: {
  client: pg.Client
  resolved: ResolvedProvisioning
  repository: ResolvedRepository
  allocation: LaneAllocation
  slug: string
  worktreePath: string
  migrateCommand: string
  seedCommand: string | undefined
  stepEnv: Record<string, string>
  options: ProvisionOptions
}): Promise<ProvisionedDatabase[]> {
  const declared: {
    database: ResolvedDatabase
    url: string
    databaseName: string
    exists: boolean
    useTemplate: boolean
  }[] = []
  for (const database of repository.databases) {
    const url = allocation.databaseUrls[database.name]
    if (url === undefined) continue
    const databaseName = laneDatabaseName(resolved.databasePrefix, slug, database.name)
    const existing = await client.query('select 1 from pg_database where datname = $1', [
      databaseName,
    ])
    const exists = Boolean(existing.rowCount)
    const useTemplate =
      repository.templateCaching && (!database.seeded || !options.skipSeed)
    if (!exists && !useTemplate) {
      await client.query(`create database "${databaseName}"`)
    }
    declared.push({ database, url, databaseName, exists, useTemplate })
  }
  const databases: ProvisionedDatabase[] = []
  for (const { database, url, databaseName, exists, useTemplate } of declared) {
    if (exists) {
      log(`database ${databaseName} already exists`)
      runStep(migrateCommand, {
        cwd: worktreePath,
        env: { ...stepEnv, [database.envKey]: url },
      })
      databases.push({ name: database.name, databaseName, url, created: false })
      continue
    }
    if (useTemplate) {
      const context: TemplateContext = {
        client,
        adminUrl: url,
        worktreePath,
        resolved,
        repository,
        database,
        migrateCommand,
        seedCommand,
        stepEnv,
      }
      await provisionDatabaseFromTemplate(
        context,
        databaseName,
        templateFingerprint(worktreePath, resolved, repository, database),
        { freshSeed: options.freshSeed ?? false },
      )
    } else {
      runStep(migrateCommand, {
        cwd: worktreePath,
        env: { ...stepEnv, [database.envKey]: url },
      })
    }
    log(`created database ${databaseName}`)
    databases.push({ name: database.name, databaseName, url, created: true })
  }
  return databases
}

/**
 * Provision one repository's databases and seed them: the databases created in
 * this same run are the only ones the seed may touch, because an existing one
 * holds a developer's data a second seed would collide with.
 */
async function provisionRepositoryDatabases({
  resolved,
  repository,
  allocation,
  slug,
  worktreePath,
  stepEnv,
  options,
}: {
  resolved: ResolvedProvisioning
  repository: ResolvedRepository
  allocation: LaneAllocation
  slug: string
  worktreePath: string
  stepEnv: Record<string, string>
  options: ProvisionOptions
}) {
  const { migrateCommand, seedCommand } = repository
  if (!migrateCommand) {
    throw new Error(`repository "${repository.path}" declares no migrateCommand`)
  }
  const [firstDatabase] = repository.databases
  const adminUrl =
    firstDatabase === undefined ? undefined : allocation.databaseUrls[firstDatabase.name]
  if (adminUrl === undefined) throw new Error('no admin database URL resolved')
  await waitForDatabaseServer(adminUrl)
  const databases = await withAdminClient(adminUrl, (client) =>
    provisionLaneDatabases({
      client,
      resolved,
      repository,
      allocation,
      slug,
      worktreePath,
      migrateCommand,
      seedCommand,
      stepEnv,
      options,
    }),
  )
  if (repository.templateCaching) {
    return { databases, seed: 'carried by the template copy' }
  }
  const seededDatabases = repository.databases.filter((database) => database.seeded)
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
    const seedEnv = { ...stepEnv }
    for (const database of seededDatabases) {
      const url = allocation.databaseUrls[database.name]
      if (url !== undefined) seedEnv[database.envKey] = url
    }
    runStep(seedCommand, { cwd: worktreePath, env: seedEnv })
    return {
      databases,
      seed: 'seeded (reseed by tearing the lane down and setting it up again)',
    }
  }
  log(`skipping the seed: ${refusal}`)
  return { databases, seed: `skipped (${refusal})` }
}

function summaryText(result: Omit<ProvisionResult, 'summary'>) {
  const lines = [
    `Lane ${result.lane} ready`,
    ...Object.entries(result.ports).map(([name, port]) => `  ${name}: ${port}`),
    ...result.repositories.flatMap((provisioned) => [
      `  ${provisioned.worktree.repository.path}: ${provisioned.worktree.worktreePath} (branch ${provisioned.worktree.branch})`,
      ...provisioned.databases.map(
        (database) =>
          `    database ${database.name}: ${database.databaseName}${database.created ? ' (created)' : ''}`,
      ),
      ...(provisioned.cacheStoreUrl
        ? [`    cache store: ${provisioned.cacheStoreUrl}`]
        : []),
      `    seed: ${provisioned.seed}`,
    ]),
  ]
  return lines.join('\n')
}

function finish(result: Omit<ProvisionResult, 'summary'>): ProvisionResult {
  const summary = summaryText(result)
  log(`\n${summary}`)
  return { ...result, summary }
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

  const selection = selectRepositories(resolved, options.repositoryPaths)
  const pool = laneResourcePool(selection)
  const branch = options.branch ?? `worktree/${lane}`
  const worktrees = laneWorktrees(mainRepository, selection, lane, branch)
  for (const worktree of worktrees) {
    ensureWorktree({
      repositoryPath: worktree.repositoryPath,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branch,
      baseReference: options.base ?? defaultBaseReference(worktree.repositoryPath),
    })
  }
  if (options.skipProvision) {
    return finish({
      lane,
      slug,
      ports: {},
      repositories: worktrees.map((worktree) => ({
        worktree,
        databases: [],
        seed: 'skipped (provisioning was skipped)',
      })),
    })
  }

  const tableStates = readTableLaneStates(mainRepository, resolved, lane, branch)
  const stateByPath = new Map(
    tableStates.map((state) => [state.worktree.repository.path, state]),
  )
  const states = selection.map((repository) => {
    const state = stateByPath.get(repository.path)
    if (!state) throw new Error(`no checkout to provision for "${repository.path}"`)
    return state
  })
  const uncoveredStates = tableStates.filter((state) => !states.includes(state))

  await startDeclaredServices(
    mainRepository,
    resolved,
    mergedMainEnvValues(tableStates.flatMap((state) => state.mainFiles)),
  )

  const ports = await resolveLanePorts(slug, pool, states, uncoveredStates)
  const cacheStoreIndex = resolveLaneCacheStoreIndex(slug, states, uncoveredStates)

  const planned = states.map((state) => ({
    state,
    allocation: repositoryAllocation(
      state,
      ports,
      cacheStoreIndex,
      slug,
      resolved.databasePrefix,
    ),
  }))
  for (const { state, allocation } of planned) {
    writeRepositoryLaneEnvFiles(state, allocation, slug)
  }
  if (cacheStoreIndex?.isNew) {
    flushNewCacheStoreDatabases(planned.map(({ allocation }) => allocation))
  }

  const repositories: ProvisionedRepository[] = []
  for (const { state, allocation } of planned) {
    const { repository, worktreePath } = state.worktree
    const stepEnv = mergedLaneEnvValues(allocation, repository, slug)
    for (const step of repository.provisionSteps) {
      runStep(step, { cwd: worktreePath, env: stepEnv })
    }

    const provisioned: ProvisionedRepository =
      repository.databases.length === 0
        ? {
            worktree: state.worktree,
            databases: [],
            seed: 'not applicable (no databases declared)',
          }
        : {
            worktree: state.worktree,
            ...(await provisionRepositoryDatabases({
              resolved,
              repository,
              allocation,
              slug,
              worktreePath,
              stepEnv,
              options,
            })),
          }
    if (allocation.cacheStoreUrl !== undefined) {
      provisioned.cacheStoreUrl = allocation.cacheStoreUrl
    }
    repositories.push(provisioned)
  }

  return finish({ lane, slug, ports, repositories })
}

export type {
  LaneWorktree,
  ProvisionedDatabase,
  ProvisionedRepository,
  ProvisionOptions,
  ProvisionResult,
}
export {
  defaultBaseReference,
  ensureWorktree,
  laneWorktrees,
  provisionLane,
  provisionLaneDatabases,
  selectRepositories,
  worktreesRoot,
}
