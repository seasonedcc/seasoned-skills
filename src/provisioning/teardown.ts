import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ProvisioningConfig } from '../config/types.js'
import {
  describeHolder,
  describeOwnership,
  isKillable,
  type Ownership,
  withOwnership,
} from '../processes/ownership.js'
import {
  assertLaneName,
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
import { type LaneProcessCandidate, processesInsideLanes } from './processes.js'
import {
  commandLine,
  flushCacheStore,
  git,
  gitSucceeds,
  log,
  portListenerProcessIds,
  processWorkingDirectory,
  resolveMainRepository,
  withAdminClient,
} from './runtime.js'
import { type LaneWorktree, laneWorktrees, worktreesRoot } from './setup.js'

/**
 * Lane teardown: refuses a lane another live Claude Code session is using, or
 * a dirty tree, unless forced; kills only processes that listen on the lane's
 * managed ports, run from inside the lane's worktrees, and belong to this
 * session or an ended one — by exact process id, after listing — flushes the
 * lane's cache-store index, drops the lane's whole derived-database family via the
 * declared derived-name patterns, and removes the worktrees. Teardown takes no
 * selection: it sweeps the lane across every declared repository, whichever
 * subset of them the lane was provisioned for. A repository the lane never
 * reached is passed over whole — it holds none of the lane's resources, and
 * reading its main checkout for an admin URL would make an unrelated
 * repository's database server a prerequisite for tearing this lane down. It
 * never touches the branch — it may back a pull request.
 */

type TeardownOptions = {
  /**
   * Remove the lane even when a worktree has uncommitted changes or another
   * live session is using it. That session's processes are still never killed.
   */
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

function isInsideAny(path: string, directories: string[]) {
  return directories.some(
    (directory) => path === directory || path.startsWith(`${directory}/`),
  )
}

function isDirty(worktreePath: string) {
  return (
    existsSync(worktreePath) &&
    git(['status', '--porcelain'], { cwd: worktreePath }) !== ''
  )
}

/**
 * Terminate the listeners on the lane's ports — but only processes whose
 * working directory is inside one of the lane's worktrees, and only those
 * this session may kill: its own and those of ended sessions. A stranger that
 * happened to grab the port, another live session's server, and an unmarked
 * process are left alone. Kills are by exact pid, listed first, never by
 * pattern.
 */
function killLanePortListeners(ports: number[], laneWorktreePaths: string[]) {
  const listeners: { port: number; processId: number; command: string }[] = []
  for (const port of ports) {
    if (!Number.isFinite(port) || port <= 0) continue
    for (const processId of portListenerProcessIds(port)) {
      if (!isInsideAny(processWorkingDirectory(processId), laneWorktreePaths)) {
        log(
          `leaving process ${processId} on port ${port} alone — it does not run from this lane's worktrees`,
        )
        continue
      }
      listeners.push({ port, processId, command: commandLine(processId) })
    }
  }
  const killed: number[] = []
  for (const listener of withOwnership(listeners)) {
    if (!isKillable(listener.ownership)) {
      log(
        `leaving process ${listener.processId} on port ${listener.port} running — ${describeOwnership(listener.ownership)}`,
      )
      continue
    }
    try {
      process.kill(listener.processId, 'SIGTERM')
    } catch {
      continue
    }
    killed.push(listener.processId)
    log(`terminated process ${listener.processId} listening on port ${listener.port}`)
  }
  return killed
}

type LiveSessionProcess = LaneProcessCandidate & {
  ownership: Extract<Ownership, { kind: 'live-session' }>
}

function laneProcessesOrRefusal(lane: string, worktrees: LaneWorktree[]) {
  try {
    return processesInsideLanes(
      worktrees.map((worktree) => worktreesRoot(worktree.repositoryPath)),
      [],
    )
  } catch (error) {
    throw new Error(
      `cannot list the processes of lane ${lane}, so nothing was changed — ${(error as Error).message}`,
    )
  }
}

function inUseRefusal(lane: string, holders: LiveSessionProcess[]) {
  const sessions = [
    ...new Map(
      holders.map((holder) => [holder.ownership.claudeProcessId, holder.ownership]),
    ).values(),
  ]
  return [
    `lane ${lane} is in use by another live Claude Code session (${sessions
      .map(describeHolder)
      .join('; ')}) — nothing was changed:`,
    ...holders.map(
      (holder) =>
        `  process ${holder.processId} runs ${holder.command} from ${holder.workingDirectory}`,
    ),
    "Re-run with force to tear it down anyway; that session's processes are left running.",
  ].join('\n')
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
  assertLaneName(lane)
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

  // Both refusals come before anything destructive: a lane another live
  // session is using, or one holding uncommitted work, is refused whole, not
  // half torn down.
  const laneWorktreePaths = worktrees.map((worktree) => worktree.worktreePath)
  if (!options.force) {
    const holders = laneProcessesOrRefusal(lane, worktrees).filter(
      (candidate): candidate is LiveSessionProcess =>
        candidate.ownership.kind === 'live-session' &&
        isInsideAny(candidate.workingDirectory, laneWorktreePaths),
    )
    if (holders.length > 0) throw new Error(inUseRefusal(lane, holders))
  }
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
  const killedProcessIds: number[] = []
  const droppedDatabases: string[] = []
  for (const worktree of worktrees) {
    const { repository } = worktree
    if (
      !existsSync(worktree.worktreePath) &&
      !isRegisteredWorktree(worktree.repositoryPath, worktree.worktreePath)
    ) {
      log(`no lane worktree at ${worktree.worktreePath}; nothing to clean up there`)
      continue
    }
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

  const removedWorktrees: string[] = []
  for (const worktree of worktrees) {
    if (removeWorktree(worktree)) removedWorktrees.push(worktree.worktreePath)
  }

  log(`teardown complete for ${lane}`)
  return { lane, removedWorktrees, droppedDatabases, killedProcessIds }
}

export type { TeardownOptions, TeardownResult }
export { killLanePortListeners, teardownLane }
