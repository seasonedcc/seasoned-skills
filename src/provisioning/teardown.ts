import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ProvisioningConfig } from '../config/types.js'
import {
  databaseNameFromUrl,
  defaultDatabasePrefix,
  isFlushableCacheStoreUrl,
  isLaneOwnedDatabaseName,
  laneDatabaseFamily,
  laneDatabaseName,
  laneSlug,
  portsClaimedByEnvFile,
  type ResolvedDatabase,
  type ResolvedEnvFile,
  type ResolvedRepository,
  readEnvValues,
  resolveProvisioning,
  withDatabaseName,
} from './common.js'
import {
  flushCacheStore,
  git,
  gitSucceeds,
  log,
  portListenerProcessIds,
  processWorkingDirectory,
  resolveMainRepository,
  withAdminClient,
} from './runtime.js'
import { type LaneWorktree, laneWorktrees } from './setup.js'

/**
 * Lane teardown: refuses a dirty tree unless forced, kills only processes
 * that both listen on the lane's managed ports and run from inside the lane's
 * worktrees — by exact process id, after listing — flushes the lane's
 * cache-store index, drops the lane's whole derived-database family via the
 * declared derived-name patterns, and removes the worktrees. Teardown takes no
 * selection: it sweeps the lane across every declared repository, whichever
 * subset of them the lane was provisioned for, skipping the ones that never
 * registered a worktree. It never touches the branch — it may back a pull
 * request.
 */

type TeardownOptions = {
  /** Remove the lane even when a worktree has uncommitted changes. */
  force?: boolean
}

type TeardownResult = {
  lane: string
  removedWorktrees: string[]
  droppedDatabases: string[]
  killedProcessIds: number[]
}

function readEnvFileValues(path: string) {
  if (!existsSync(path)) return {}
  return readEnvValues(readFileSync(path, 'utf8'))
}

/** Every declared env file with its recorded values at a given root. */
function readLaneEnvFiles(root: string, envFiles: ResolvedEnvFile[]) {
  return envFiles.map((file) => ({
    file,
    values: readEnvFileValues(join(root, file.path)),
  }))
}

type LaneEnvFileValues = ReturnType<typeof readLaneEnvFiles>

/**
 * A database's recorded lane URL, read under its env key from the files that
 * carry that database — the same key name may point at a different database
 * in another file.
 */
function recordedDatabaseUrl(laneFiles: LaneEnvFileValues, database: ResolvedDatabase) {
  return laneFiles
    .filter(({ file }) =>
      file.databases.some((candidate) => candidate.name === database.name),
    )
    .map(({ values }) => values[database.envKey])
    .find(Boolean)
}

function isRegisteredWorktree(repositoryPath: string, worktreePath: string) {
  return git(['worktree', 'list', '--porcelain'], { cwd: repositoryPath })
    .split('\n')
    .some((line) => line === `worktree ${worktreePath}`)
}

function isDirty(worktreePath: string) {
  return (
    existsSync(worktreePath) &&
    git(['status', '--porcelain'], { cwd: worktreePath }) !== ''
  )
}

/**
 * Terminate the listeners on the lane's ports — but only processes whose
 * working directory is inside one of the lane's worktrees. A stranger that
 * happened to grab the port is left alone. Kills are by exact pid, listed
 * first, never by pattern.
 */
function killLanePortListeners(ports: number[], laneWorktreePaths: string[]) {
  const killed: number[] = []
  for (const port of ports) {
    if (!Number.isFinite(port) || port <= 0) continue
    for (const processId of portListenerProcessIds(port)) {
      const workingDirectory = processWorkingDirectory(processId)
      const insideLane = laneWorktreePaths.some(
        (path) => workingDirectory === path || workingDirectory.startsWith(`${path}/`),
      )
      if (!insideLane) {
        log(
          `leaving process ${processId} on port ${port} alone — it does not run from this lane's worktrees`,
        )
        continue
      }
      try {
        process.kill(processId, 'SIGTERM')
      } catch {
        continue
      }
      killed.push(processId)
      log(`terminated process ${processId} listening on port ${port}`)
    }
  }
  return killed
}

async function dropLaneDatabase(adminUrl: string, name: string, prefix: string) {
  if (!/^[a-z0-9_]+$/.test(name)) {
    log(`refusing to drop "${name}" (not a safe database name)`)
    return false
  }
  if (!name.includes(prefix)) {
    log(`refusing to drop "${name}" (not a ${prefix}* database)`)
    return false
  }
  await withAdminClient(adminUrl, async (client) => {
    await client.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    )
    await client.query(`drop database if exists "${name}"`)
  })
  log(`dropped database ${name}`)
  return true
}

/**
 * The admin URL one repository's databases are dropped through: what the lane
 * recorded, else what the main checkout carries, else any Postgres URL the
 * lane's env files hold.
 */
function adminDatabaseUrl(
  repository: ResolvedRepository,
  laneFiles: LaneEnvFileValues,
  mainFiles: LaneEnvFileValues,
) {
  const [firstDatabase] = repository.databases
  if (firstDatabase === undefined) return undefined
  return (
    recordedDatabaseUrl(laneFiles, firstDatabase) ??
    recordedDatabaseUrl(mainFiles, firstDatabase) ??
    laneFiles
      .flatMap(({ values }) => Object.values(values))
      .find((value) => value.startsWith('postgres'))
  )
}

/** Drop one repository's whole lane database family, guarded by the lane prefix. */
async function dropRepositoryDatabases({
  repository,
  laneFiles,
  mainFiles,
  slug,
  databasePrefix,
}: {
  repository: ResolvedRepository
  laneFiles: LaneEnvFileValues
  mainFiles: LaneEnvFileValues
  slug: string
  databasePrefix: string
}) {
  const adminUrl = adminDatabaseUrl(repository, laneFiles, mainFiles)
  if (!adminUrl) {
    log(`no database URL available for "${repository.path}"; skipping database cleanup`)
    return []
  }
  const laneDatabases = repository.databases.map((database) => ({
    baseName: laneDatabaseName(databasePrefix, slug, database.name),
    derivedPatterns: database.derivedPatterns,
  }))
  const existingNames = await withAdminClient(adminUrl, async (client) => {
    const result = await client.query<{ datname: string }>(
      'select datname from pg_database',
    )
    return result.rows.map((row) => row.datname)
  })
  const family = new Set([
    ...laneDatabaseFamily(existingNames, laneDatabases),
    // Names the env files record, in case a hand-tuned allocation strayed
    // from the derived names — still guarded by the lane-owned prefix.
    ...repository.databases
      .map((database) => recordedDatabaseUrl(laneFiles, database))
      .filter((url): url is string => Boolean(url))
      .map(databaseNameFromUrl)
      .filter((name) => isLaneOwnedDatabaseName(databasePrefix, name)),
  ])
  const dropped: string[] = []
  for (const name of family) {
    if (await dropLaneDatabase(withDatabaseName(adminUrl, name), name, databasePrefix)) {
      dropped.push(name)
    }
  }
  return dropped
}

function removeWorktree(worktree: LaneWorktree) {
  if (isRegisteredWorktree(worktree.repositoryPath, worktree.worktreePath)) {
    git(['worktree', 'remove', '--force', worktree.worktreePath], {
      cwd: worktree.repositoryPath,
    })
    log(`removed worktree at ${worktree.worktreePath}`)
    return true
  }
  gitSucceeds(['worktree', 'prune'], { cwd: worktree.repositoryPath })
  log(`no worktree registered at ${worktree.worktreePath}`)
  return false
}

async function teardownLane(
  projectRoot: string,
  config: ProvisioningConfig | undefined,
  lane: string,
  options: TeardownOptions = {},
): Promise<TeardownResult> {
  const mainRepository = resolveMainRepository(projectRoot)
  const resolved = resolveProvisioning(config, {
    databasePrefix: defaultDatabasePrefix(basename(mainRepository)),
  })
  const slug = laneSlug(lane)
  if (!slug) throw new Error(`cannot derive a slug from "${lane}"`)

  const worktrees = laneWorktrees(
    mainRepository,
    resolved.repositories,
    lane,
    `worktree/${lane}`,
  )

  // The dirty check comes before anything destructive: a lane holding
  // uncommitted work is refused whole, not half torn down.
  for (const worktree of worktrees) {
    if (isDirty(worktree.worktreePath) && !options.force) {
      throw new Error(
        `worktree at ${worktree.worktreePath} has uncommitted changes; re-run with force to remove it anyway`,
      )
    }
  }

  // Ports and recorded URLs come from every declared env file of every
  // declared repository, each read with its own key→port mapping — the same
  // key name in two files claims both values.
  const laneWorktreePaths = worktrees.map((worktree) => worktree.worktreePath)
  const killedProcessIds: number[] = []
  const droppedDatabases: string[] = []
  for (const worktree of worktrees) {
    const { repository } = worktree
    const laneFiles = readLaneEnvFiles(worktree.worktreePath, repository.envFiles)
    killedProcessIds.push(
      ...killLanePortListeners(
        laneFiles.flatMap(({ file, values }) =>
          portsClaimedByEnvFile(values, file, repository.portBlocks),
        ),
        laneWorktreePaths,
      ),
    )

    const cacheKey = repository.cacheStoreEnvKeys[0]
    const cacheUrl =
      cacheKey === undefined
        ? undefined
        : laneFiles
            .filter(({ file }) => file.cacheStore)
            .map(({ values }) => values[cacheKey])
            .find(Boolean)
    if (repository.cacheStoreIndex && cacheUrl && isFlushableCacheStoreUrl(cacheUrl)) {
      flushCacheStore(cacheUrl)
    }

    if (repository.databases.length > 0) {
      droppedDatabases.push(
        ...(await dropRepositoryDatabases({
          repository,
          laneFiles,
          mainFiles: readLaneEnvFiles(worktree.repositoryPath, repository.envFiles),
          slug,
          databasePrefix: resolved.databasePrefix,
        })),
      )
    }
  }

  const removedWorktrees = worktrees
    .filter(removeWorktree)
    .map((worktree) => worktree.worktreePath)

  log(`teardown complete for ${lane}`)
  return { lane, removedWorktrees, droppedDatabases, killedProcessIds }
}

export type { TeardownOptions, TeardownResult }
export { killLanePortListeners, teardownLane }
