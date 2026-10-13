import { spawnSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { basename } from 'node:path'
import type { ProvisioningConfig } from '../config/types.js'
import {
  isKillable,
  type Ownership,
  ownProcessIds,
  withOwnership,
} from '../processes/ownership.js'
import {
  assertLaneName,
  defaultDatabasePrefix,
  type LaneProcess,
  laneProcessesFromLsofOutput,
  resolveProvisioning,
  sessionEndCleansUpProcesses,
} from './common.js'
import { commandLine, resolveMainRepository } from './runtime.js'
import { laneWorktrees, worktreesRoot } from './setup.js'

/**
 * Lane-process handling: enumerate the processes running from inside a lane
 * (lsof by working directory under the worktrees roots), each with the Claude
 * Code instance it belongs to, and sweep the ones this session may kill — its
 * own, and those of sessions that ended — each by its exact process id. The
 * CLI's `sweep --lane-processes` and the session-end hook both land here.
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
  return {
    resolved,
    roots: laneWorktrees(mainRepository, resolved.repositories, 'any', 'any').map(
      (worktree) => worktreesRoot(worktree.repositoryPath),
    ),
  }
}

/**
 * This user's processes running from inside a lane under the given worktrees
 * roots, with their ownership — restricted to the given command names when
 * there are any. This process and its ancestors are never listed. A listing
 * lsof could not make throws rather than reading as an empty lane: lsof exits
 * 1 both when nothing matches and on errors, which only the latter explain on
 * stderr.
 */
function lanesProcesses(roots: string[], commands: string[]) {
  const result = spawnSync(
    'lsof',
    [
      '-a',
      '-u',
      userInfo().username,
      '-d',
      'cwd',
      ...commands.flatMap((name) => ['-c', name]),
      '-F',
      'pn',
    ],
    { encoding: 'utf8' },
  )
  const listed =
    result.error === undefined &&
    (result.status === 0 || (result.status === 1 && result.stderr === ''))
  if (!listed) {
    const reason =
      result.error?.message ??
      (result.stderr.trim() ||
        (result.signal ? `killed by ${result.signal}` : `exit status ${result.status}`))
    throw new Error(
      `lsof could not list the processes running from inside lanes: ${reason}`,
    )
  }
  const own = ownProcessIds()
  return withOwnership(
    laneProcessesFromLsofOutput(result.stdout ?? '', roots)
      .filter((candidate) => !own.has(candidate.processId))
      .map((candidate) => ({ ...candidate, command: commandLine(candidate.processId) })),
  )
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
  const { resolved, roots } = laneWorktreesRoots(
    resolveMainRepository(projectRoot),
    config,
  )
  return lanesProcesses(roots, resolved.laneProcessCommands).filter(
    (candidate) => options.lane === undefined || candidate.lane === options.lane,
  )
}

/**
 * Terminate the lane processes this session may kill — its own and those of
 * ended sessions — each by its exact process id with SIGTERM. Another live
 * session's processes and unmarked ones are listed and left running.
 */
function sweepLaneProcesses(
  projectRoot: string,
  config: ProvisioningConfig | undefined,
  options: LaneProcessOptions = {},
) {
  const candidates = listLaneProcesses(projectRoot, config, options)
  const terminated: LaneProcessCandidate[] = []
  for (const candidate of candidates) {
    if (!isKillable(candidate.ownership)) continue
    try {
      process.kill(candidate.processId, 'SIGTERM')
    } catch {
      continue
    }
    terminated.push(candidate)
  }
  return { candidates, terminated }
}

export type { LaneProcessCandidate, LaneProcessOptions }
export {
  lanesProcesses,
  listLaneProcesses,
  sessionEndCleansUpProcesses,
  sweepLaneProcesses,
}
