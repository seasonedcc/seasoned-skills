import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

/**
 * Which Claude Code instance a process belongs to. Claude Code puts its own
 * process id in CLAUDE_PID for every command it runs, and every descendant
 * inherits it, so a process's launch environment names the instance whose
 * session started it. Every kill this package performs asks here first, and
 * kills only the sweeper's own processes and those of sessions that ended.
 *
 * An instance counts as still running only while its pid belongs to a process
 * that started no later than the process it marks: Claude Code always exists
 * before what it starts, so a pid now held by a younger process can only be a
 * recycled one. That ordering errs only toward "still running" — at worst a
 * leftover is spared — and holds however Claude Code was installed or named.
 * A Claude Code process itself is always another live session.
 */

type Ownership =
  | { kind: 'mine' }
  | { kind: 'ended-session'; claudeProcessId: number; sessionId?: string }
  | { kind: 'live-session'; claudeProcessId: number; sessionId?: string }
  | { kind: 'unmarked' }

type RunningProcess = { processId: number; command: string }

type ProcessSnapshot = {
  /** When each running process started, in milliseconds since the epoch. */
  startTimes: Map<number, number>
  /** Launch environments of the processes asked about; absent when unreadable. */
  environments: Map<number, Record<string, string>>
}

function parseProcessId(value: string | undefined) {
  return value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : undefined
}

function sweeperClaudeProcessId(environment: Record<string, string | undefined>) {
  return parseProcessId(environment.CLAUDE_PID)
}

function isClaudeCodeCommand(command: string) {
  const [executable = ''] = command.trim().split(/\s+/)
  return (
    basename(executable) === 'claude' ||
    executable.includes('/claude/versions/') ||
    command.includes('/@anthropic-ai/claude-code/')
  )
}

function classifyOwnership(
  candidate: RunningProcess,
  snapshot: ProcessSnapshot,
  sweeper: number | undefined,
): Ownership {
  if (isClaudeCodeCommand(candidate.command)) {
    return { kind: 'live-session', claudeProcessId: candidate.processId }
  }
  const environment = snapshot.environments.get(candidate.processId)
  const claudeProcessId = parseProcessId(environment?.CLAUDE_PID)
  if (environment === undefined || claudeProcessId === undefined) {
    return { kind: 'unmarked' }
  }
  if (claudeProcessId === sweeper) return { kind: 'mine' }
  const sessionId = environment.CLAUDE_CODE_SESSION_ID
  const holder = sessionId ? { claudeProcessId, sessionId } : { claudeProcessId }
  const claudeStarted = snapshot.startTimes.get(claudeProcessId)
  const candidateStarted = snapshot.startTimes.get(candidate.processId)
  const ended =
    claudeStarted === undefined ||
    (candidateStarted !== undefined && claudeStarted > candidateStarted)
  return { kind: ended ? 'ended-session' : 'live-session', ...holder }
}

function isKillable(ownership: Ownership) {
  return ownership.kind === 'mine' || ownership.kind === 'ended-session'
}

function describeHolder(holder: { claudeProcessId: number; sessionId?: string }) {
  return holder.sessionId
    ? `pid ${holder.claudeProcessId}, session ${holder.sessionId}`
    : `pid ${holder.claudeProcessId}`
}

function describeOwnership(ownership: Ownership) {
  switch (ownership.kind) {
    case 'mine':
      return 'mine'
    case 'unmarked':
      return 'unmarked'
    case 'ended-session':
      return `ended session (Claude Code ${describeHolder(ownership)})`
    case 'live-session':
      return `another live session (Claude Code ${describeHolder(ownership)})`
  }
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Parses `ps -A -o pid=,lstart=` run under TZ=UTC and the C locale. */
function startTimesFromPsOutput(output: string) {
  const startTimes = new Map<number, number>()
  for (const line of output.split('\n')) {
    const match = line.match(
      /^\s*(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*$/,
    )
    if (!match) continue
    const [, processId, month, day, hours, minutes, seconds, year] = match
    startTimes.set(
      Number(processId),
      Date.UTC(
        Number(year),
        MONTHS.indexOf(month ?? ''),
        Number(day),
        Number(hours),
        Number(minutes),
        Number(seconds),
      ),
    )
  }
  return startTimes
}

function firstValueWins(entries: [string, string][]) {
  const environment: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (!(key in environment)) environment[key] = value
  }
  return environment
}

/** Parses a Linux `/proc/<pid>/environ` file. */
function environmentFromProcFile(contents: string) {
  return firstValueWins(
    contents
      .split('\0')
      .filter((entry) => entry.includes('='))
      .map((entry) => {
        const separator = entry.indexOf('=')
        return [entry.slice(0, separator), entry.slice(separator + 1)]
      }),
  )
}

function linesByProcessId(output: string) {
  const lines = new Map<number, string>()
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+) (.*)$/)
    if (match) lines.set(Number(match[1]), (match[2] ?? '').trimEnd())
  }
  return lines
}

/**
 * Parses the macOS environment listing: `ps -E` appends the launch
 * environment to the command line, so what it adds beyond the plain listing is
 * the environment. A process whose environment ps hides — Apple's own
 * binaries — adds nothing and stays unread.
 */
function environmentsFromPsOutput(
  commandsOutput: string,
  withEnvironmentsOutput: string,
) {
  const commands = linesByProcessId(commandsOutput)
  const environments = new Map<number, Record<string, string>>()
  for (const [processId, line] of linesByProcessId(withEnvironmentsOutput)) {
    const command = commands.get(processId)
    if (command === undefined || !line.startsWith(command)) continue
    const text = line.slice(command.length)
    const keys = [...text.matchAll(/\s([A-Za-z_][A-Za-z0-9_]*)=/g)]
    if (keys.length === 0) continue
    environments.set(
      processId,
      firstValueWins(
        keys.map((key, index) => [
          key[1] ?? '',
          text.slice(key.index + key[0].length, keys[index + 1]?.index ?? text.length),
        ]),
      ),
    )
  }
  return environments
}

function readStartTimes() {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,lstart='], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
  })
  const startTimes = startTimesFromPsOutput(result.stdout ?? '')
  if (!startTimes.has(process.pid)) {
    throw new Error(
      'cannot read the process table, so no process can be told apart from another session’s; nothing was killed',
    )
  }
  return startTimes
}

function readEnvironments(processIds: number[], platform: NodeJS.Platform) {
  if (platform === 'linux') {
    const environments = new Map<number, Record<string, string>>()
    for (const processId of processIds) {
      try {
        environments.set(
          processId,
          environmentFromProcFile(readFileSync(`/proc/${processId}/environ`, 'utf8')),
        )
      } catch {}
    }
    return environments
  }
  const list = processIds.join(',')
  const listing = (extra: string[]) =>
    spawnSync('ps', [...extra, '-ww', '-o', 'pid=,command=', '-p', list], {
      encoding: 'utf8',
    }).stdout ?? ''
  return environmentsFromPsOutput(listing([]), listing(['-E']))
}

function readProcessSnapshot(
  processIds: number[],
  platform: NodeJS.Platform = process.platform,
): ProcessSnapshot {
  return {
    startTimes: readStartTimes(),
    environments:
      processIds.length === 0 ? new Map() : readEnvironments(processIds, platform),
  }
}

/** This process and its ancestors — never candidates for a sweep. */
function ownProcessIds() {
  const ids = new Set<number>()
  let current = process.pid
  while (current > 1 && !ids.has(current)) {
    ids.add(current)
    const result = spawnSync('ps', ['-o', 'ppid=', '-p', String(current)], {
      encoding: 'utf8',
    })
    current = Number(result.stdout?.trim())
  }
  return ids
}

/** Each process with its ownership, judged from one snapshot of the process table. */
function withOwnership<Candidate extends RunningProcess>(candidates: Candidate[]) {
  if (candidates.length === 0) return []
  const snapshot = readProcessSnapshot(candidates.map((candidate) => candidate.processId))
  const sweeper = sweeperClaudeProcessId(process.env)
  return candidates.map((candidate) => ({
    ...candidate,
    ownership: classifyOwnership(candidate, snapshot, sweeper),
  }))
}

export type { Ownership, ProcessSnapshot, RunningProcess }
export {
  classifyOwnership,
  describeHolder,
  describeOwnership,
  environmentFromProcFile,
  environmentsFromPsOutput,
  isKillable,
  ownProcessIds,
  readProcessSnapshot,
  startTimesFromPsOutput,
  sweeperClaudeProcessId,
  withOwnership,
}
