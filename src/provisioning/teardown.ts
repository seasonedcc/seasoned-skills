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
  portsClaimedByEnv,
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
import { laneWorktrees } from './setup.js'

/**
 * Lane teardown: refuses a dirty tree unless forced, kills only processes
 * that both listen on the lane's managed ports and run from inside the lane's
 * worktrees — by exact process id, after listing — flushes the lane's
 * cache-store index, drops the lane's whole derived-database family via the
 * declared derived-name patterns, and removes the worktrees. It never touches
 * the branch — it may back a pull request.
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

  const worktrees = laneWorktrees(mainRepository, resolved, lane, `worktree/${lane}`)
  const primary = worktrees[0]
  if (!primary) throw new Error('the resource table resolved to no repositories')

  // The dirty check comes before anything destructive: a lane holding
  // uncommitted work is refused whole, not half torn down.
  for (const worktree of worktrees) {
    if (isDirty(worktree.worktreePath) && !options.force) {
      throw new Error(
        `worktree at ${worktree.worktreePath} has uncommitted changes; re-run with force to remove it anyway`,
      )
    }
  }

  const envValues = readEnvFileValues(join(primary.worktreePath, resolved.envFile))
  const laneWorktreePaths = worktrees.map((worktree) => worktree.worktreePath)
  const killedProcessIds = killLanePortListeners(
    portsClaimedByEnv(envValues, resolved.portBases, resolved.portBlocks),
    laneWorktreePaths,
  )

  const cacheKey = resolved.cacheStoreEnvKeys[0]
  const cacheUrl = cacheKey === undefined ? undefined : envValues[cacheKey]
  if (resolved.cacheStoreIndex && cacheUrl && isFlushableCacheStoreUrl(cacheUrl)) {
    flushCacheStore(cacheUrl)
  }

  const droppedDatabases: string[] = []
  if (resolved.databases.length > 0) {
    const mainEnvValues = readEnvFileValues(
      join(primary.repositoryPath, resolved.envFile),
    )
    const primaryKey = resolved.databases[0]?.envKey
    const adminUrl =
      (primaryKey === undefined ? undefined : envValues[primaryKey]) ??
      (primaryKey === undefined ? undefined : mainEnvValues[primaryKey]) ??
      Object.values(envValues).find((value) => value.startsWith('postgres'))
    if (adminUrl) {
      const laneDatabases = resolved.databases.map((database) => ({
        baseName: laneDatabaseName(resolved.databasePrefix, slug, database.name),
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
        // Names the env file records, in case a hand-tuned allocation strayed
        // from the derived names — still guarded by the lane-owned prefix.
        ...resolved.databases
          .map((database) => envValues[database.envKey])
          .filter((url): url is string => Boolean(url))
          .map(databaseNameFromUrl)
          .filter((name) => isLaneOwnedDatabaseName(resolved.databasePrefix, name)),
      ])
      for (const name of family) {
        if (
          await dropLaneDatabase(
            withDatabaseName(adminUrl, name),
            name,
            resolved.databasePrefix,
          )
        ) {
          droppedDatabases.push(name)
        }
      }
    } else {
      log('no database URL available; skipping database cleanup')
    }
  }

  const removedWorktrees: string[] = []
  for (const worktree of worktrees) {
    if (isRegisteredWorktree(worktree.repositoryPath, worktree.worktreePath)) {
      git(['worktree', 'remove', '--force', worktree.worktreePath], {
        cwd: worktree.repositoryPath,
      })
      removedWorktrees.push(worktree.worktreePath)
      log(`removed worktree at ${worktree.worktreePath}`)
    } else {
      gitSucceeds(['worktree', 'prune'], { cwd: worktree.repositoryPath })
      log(`no worktree registered at ${worktree.worktreePath}`)
    }
  }

  log(`teardown complete for ${lane}`)
  return { lane, removedWorktrees, droppedDatabases, killedProcessIds }
}

export type { TeardownOptions, TeardownResult }
export { killLanePortListeners, teardownLane }
