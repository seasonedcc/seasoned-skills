import { spawnSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { basename } from 'node:path'
import type { ProvisioningConfig } from '../config/types.js'
import {
  defaultDatabasePrefix,
  type LaneProcess,
  laneProcessesFromLsofOutput,
  resolveProvisioning,
  sessionEndCleansUpProcesses,
} from './common.js'
import { commandLine, log, ownProcessIds, resolveMainRepository } from './runtime.js'
import { laneWorktrees, worktreesRoot } from './setup.js'

/**
 * Lane-process handling: enumerate the processes running from inside a lane
 * (lsof by working directory under the worktrees roots), and sweep orphans.
 * Every kill is by exact process id, after listing — never by pattern. The
 * CLI's `sweep --lane-processes` and the session-end hook both land here.
 */

type SweptProcess = LaneProcess & { command: string }

type LaneProcessOptions = {
  /** Restrict to one lane's processes. */
  lane?: string
}

function laneWorktreesRoots(
  mainRepository: string,
  config: ProvisioningConfig | undefined,
) {
  const resolved = resolveProvisioning(config, {
    databasePrefix: defaultDatabasePrefix(basename(mainRepository)),
  })
  return {
    resolved,
    roots: laneWorktrees(mainRepository, resolved.repositories, 'any', 'any').map(
      (worktree) => worktreesRoot(worktree.repositoryPath),
    ),
  }
}

/**
 * List the processes whose working directory sits inside a lane, across every
 * declared repository's worktrees root. This process and its ancestors are
 * never listed.
 */
function listLaneProcesses(
  projectRoot: string,
  config: ProvisioningConfig | undefined,
  options: LaneProcessOptions = {},
): SweptProcess[] {
  const mainRepository = resolveMainRepository(projectRoot)
  const { resolved, roots } = laneWorktreesRoots(mainRepository, config)
  const result = spawnSync(
    'lsof',
    [
      '-a',
      '-u',
      userInfo().username,
      '-d',
      'cwd',
      ...resolved.laneProcessCommands.flatMap((name) => ['-c', name]),
      '-F',
      'pn',
    ],
    { encoding: 'utf8' },
  )
  const own = ownProcessIds()
  return laneProcessesFromLsofOutput(result.stdout ?? '', roots)
    .filter(
      (candidate) =>
        !own.has(candidate.processId) &&
        (!options.lane || candidate.lane === options.lane),
    )
    .map((candidate) => ({ ...candidate, command: commandLine(candidate.processId) }))
}

/**
 * Terminate a lane's (or every lane's) processes. Lists first, then kills
 * each by its exact process id with SIGTERM. Returns what was killed.
 */
function sweepLaneProcesses(
  projectRoot: string,
  config: ProvisioningConfig | undefined,
  options: LaneProcessOptions = {},
): SweptProcess[] {
  const processes = listLaneProcesses(projectRoot, config, options)
  const killed: SweptProcess[] = []
  for (const candidate of processes) {
    try {
      process.kill(candidate.processId, 'SIGTERM')
    } catch {
      log(`process ${candidate.processId} in lane ${candidate.lane} already exited`)
      continue
    }
    killed.push(candidate)
    log(
      `terminated ${candidate.processId} in lane ${candidate.lane}: ${candidate.command}`,
    )
  }
  return killed
}

export type { LaneProcessOptions, SweptProcess }
export { listLaneProcesses, sessionEndCleansUpProcesses, sweepLaneProcesses }
