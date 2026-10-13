import { basename } from 'node:path'
import type { ProvisioningConfig } from '../config/types.js'
import { isKillable, type Ownership, withOwnership } from '../processes/ownership.js'
import {
  assertLaneName,
  defaultDatabasePrefix,
  type LaneProcess,
  laneProcessesAmong,
  resolveProvisioning,
  sessionEndCleansUpProcesses,
} from './common.js'
import { processWorkingDirectories, resolveMainRepository } from './runtime.js'
import { laneWorktrees, worktreesRoot } from './setup.js'

/**
 * Lane-process handling: enumerate every process running from inside a lane
 * (by working directory under the worktrees roots), whatever its name, each
 * with the Claude Code instance it belongs to, and sweep the ones this session
 * may kill — its own, and those of sessions that ended — each by its exact
 * process id. The CLI's `sweep --lane-processes` and the session-end hook both
 * land here.
 */

type LaneProcessCandidate = LaneProcess & { command: string; ownership: Ownership }

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
  return laneWorktrees(mainRepository, resolved.repositories, 'any', 'any').map(
    (worktree) => worktreesRoot(worktree.repositoryPath),
  )
}

/**
 * Every process of this user running from inside a lane under the given
 * worktrees roots, with its command line and its ownership. This process and its ancestors are
 * never listed. A listing that could not be made throws rather than reading
 * as an empty lane.
 */
function processesInsideLanes(roots: string[]) {
  return withOwnership(laneProcessesAmong(processWorkingDirectories(), roots))
}

/**
 * List the processes whose working directory sits inside a lane, across every
 * declared repository's worktrees root, each with its ownership.
 */
function listLaneProcesses(
  projectRoot: string,
  config: ProvisioningConfig | undefined,
  options: LaneProcessOptions = {},
): LaneProcessCandidate[] {
  if (options.lane !== undefined) assertLaneName(options.lane)
  const roots = laneWorktreesRoots(resolveMainRepository(projectRoot), config)
  return processesInsideLanes(roots).filter(
    (candidate) => options.lane === undefined || candidate.lane === options.lane,
  )
}

/**
 * Terminate the lane processes this session may kill — its own and those of
 * ended sessions — each by its exact process id with SIGTERM. Another live
 * session's processes and unmarked ones are listed and left running. A kill
 * the system refuses is reported apart from a process that exited first.
 */
function sweepLaneProcesses(
  projectRoot: string,
  config: ProvisioningConfig | undefined,
  options: LaneProcessOptions = {},
) {
  const candidates = listLaneProcesses(projectRoot, config, options)
  const terminated: LaneProcessCandidate[] = []
  const failed: LaneProcessCandidate[] = []
  for (const candidate of candidates) {
    if (!isKillable(candidate.ownership)) continue
    try {
      process.kill(candidate.processId, 'SIGTERM')
      terminated.push(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failed.push(candidate)
    }
  }
  return { candidates, terminated, failed }
}

export type { LaneProcessCandidate, LaneProcessOptions }
export {
  listLaneProcesses,
  processesInsideLanes,
  sessionEndCleansUpProcesses,
  sweepLaneProcesses,
}
