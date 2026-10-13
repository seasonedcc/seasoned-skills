import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

/**
 * Which Claude Code instance a process belongs to. Every kill this package
 * performs asks here first, and kills only the sweeper's own processes and
 * those of sessions that ended.
 *
 * The owner is found from the process's ancestry first: a process started
 * under a running Claude Code instance belongs to the nearest one above it.
 * Failing that, its Claude Code marker decides: Claude Code puts its own
 * process id in CLAUDE_PID for every command it runs, and every descendant
 * inherits it, so the nearest launch environment along the ancestry that can
 * be read and carries it names the instance whose session started the
 * process. A process with neither is unmarked, and never killed.
 *
 * A marked instance counts as still running while its pid belongs to a
 * process that started no later than the process it marks — Claude Code
 * always exists before what it starts, so a pid now held by a younger process
 * can only be a recycled one — or while that pid exists at all. Every
 * uncertainty errs toward "still running", so at worst a leftover is spared.
 */

type Holder = { claudeProcessId: number; sessionId?: string }

type Ownership =
  | { kind: 'mine' }
  | ({ kind: 'ended-session' } & Holder)
  | ({ kind: 'live-session' } & Holder)
  | { kind: 'unmarked' }

type ProcessEntry = {
  parentProcessId: number
  /** In milliseconds since the epoch, at whole-second resolution. */
  started: number
  command: string
}

type ProcessSnapshot = {
  /** Every running process, by its pid. */
  processes: Map<number, ProcessEntry>
  /** The markers read from launch environments; absent when unreadable or unmarked. */
  markers: Map<number, Holder>
  /** Whether a pid belongs to any process, even one the table left out. */
  processExists: (processId: number) => boolean
}

function parseProcessId(value: string | undefined) {
  return value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : undefined
}

function isClaudeCodeCommand(command: string) {
  const [executable = ''] = command.trim().split(/\s+/)
  return (
    basename(executable) === 'claude' ||
    executable.includes('/claude/versions/') ||
    command.includes('/@anthropic-ai/claude-code/')
  )
}

/** A process and its ancestors, nearest first, up to but excluding pid 1. */
function lineage(processes: Map<number, ProcessEntry>, processId: number) {
  const chain: number[] = []
  let current: number | undefined = processId
  while (current !== undefined && current > 1 && !chain.includes(current)) {
    chain.push(current)
    current = processes.get(current)?.parentProcessId
  }
  return chain
}

function holder(claudeProcessId: number, sessionId: string | undefined): Holder {
  return sessionId ? { claudeProcessId, sessionId } : { claudeProcessId }
}

/**
 * The nearest Claude Code instance above a process: the sweeper's own, a
 * process whose command is Claude Code, or one a marker below it names. Being
 * an ancestor of what it marks, a named pid cannot be a recycled one.
 */
function nearestInstance(chain: number[], snapshot: ProcessSnapshot, sweeper?: number) {
  for (const [index, ancestor] of chain.entries()) {
    if (index === 0) continue
    const naming = chain
      .slice(0, index)
      .map((member) => snapshot.markers.get(member))
      .find((marker) => marker?.claudeProcessId === ancestor)
    if (
      ancestor === sweeper ||
      naming !== undefined ||
      isClaudeCodeCommand(snapshot.processes.get(ancestor)?.command ?? '')
    ) {
      return holder(ancestor, naming?.sessionId)
    }
  }
  return undefined
}

function classifyOwnership(
  processId: number,
  snapshot: ProcessSnapshot,
  sweeper: number | undefined,
): Ownership {
  if (isClaudeCodeCommand(snapshot.processes.get(processId)?.command ?? '')) {
    return { kind: 'live-session', claudeProcessId: processId }
  }
  const chain = lineage(snapshot.processes, processId)
  const instance = nearestInstance(chain, snapshot, sweeper)
  if (instance !== undefined) {
    return instance.claudeProcessId === sweeper
      ? { kind: 'mine' }
      : { kind: 'live-session', ...instance }
  }
  const marked = chain.find((member) => snapshot.markers.has(member))
  const marker = marked === undefined ? undefined : snapshot.markers.get(marked)
  if (marked === undefined || marker === undefined) return { kind: 'unmarked' }
  if (marker.claudeProcessId === sweeper) return { kind: 'mine' }
  const claudeStarted = snapshot.processes.get(marker.claudeProcessId)?.started
  const markedStarted = snapshot.processes.get(marked)?.started
  const ended =
    claudeStarted === undefined
      ? !snapshot.processExists(marker.claudeProcessId)
      : markedStarted !== undefined && claudeStarted > markedStarted
  return { kind: ended ? 'ended-session' : 'live-session', ...marker }
}

function isKillable(ownership: Ownership) {
  return ownership.kind === 'mine' || ownership.kind === 'ended-session'
}

function describeHolder(holder: Holder) {
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

/** Parses `ps -A -ww -o pid=,ppid=,lstart=,command=` run under TZ=UTC and the C locale. */
function processesFromPsOutput(output: string) {
  const processes = new Map<number, ProcessEntry>()
  for (const line of output.split('\n')) {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})(?:\s(.*))?$/,
    )
    if (!match) continue
    const [, processId, parentProcessId, month, day, hours, minutes, seconds, year] =
      match
    processes.set(Number(processId), {
      parentProcessId: Number(parentProcessId),
      started: Date.UTC(
        Number(year),
        MONTHS.indexOf(month ?? ''),
        Number(day),
        Number(hours),
        Number(minutes),
        Number(seconds),
      ),
      command: (match[9] ?? '').trim(),
    })
  }
  return processes
}

function markerFromValues(
  claudeProcessIds: string[],
  sessionIds: string[],
): Holder | undefined {
  const [claudeProcessId, ...others] = new Set(claudeProcessIds)
  const parsed = others.length === 0 ? parseProcessId(claudeProcessId) : undefined
  if (parsed === undefined) return undefined
  const [sessionId, ...otherSessions] = new Set(sessionIds)
  return holder(parsed, otherSessions.length === 0 ? sessionId : undefined)
}

/**
 * Reads the marker from a Linux `/proc/<pid>/environ` file. Its entries are
 * NUL-separated, so each is read exactly; a repeated variable keeps its first
 * value, as the process itself reads it.
 */
function markerFromProcFile(contents: string) {
  const entries = contents.split('\0')
  const first = (key: string) =>
    entries.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1)
  return markerFromValues(
    [first('CLAUDE_PID')].filter((value) => value !== undefined),
    [first('CLAUDE_CODE_SESSION_ID')].filter((value) => value !== undefined),
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
 * Reads the markers from the macOS environment listing: `ps -E` appends the
 * launch environment to the command line, space-separated, so what it adds
 * beyond the plain listing is the environment. A process whose environment ps
 * hides — Apple's own binaries, and any process that renamed itself — adds
 * nothing and stays unread. Spaces inside values make the entries ambiguous,
 * so each marker variable is matched as a whole word, and a variable found
 * with conflicting values — one of them inside another variable's value —
 * reads as no marker at all.
 */
function markersFromPsOutput(commandsOutput: string, withEnvironmentsOutput: string) {
  const commands = linesByProcessId(commandsOutput)
  const markers = new Map<number, Holder>()
  for (const [processId, line] of linesByProcessId(withEnvironmentsOutput)) {
    const command = commands.get(processId)
    if (command === undefined || !line.startsWith(command)) continue
    const environment = line.slice(command.length)
    const values = (key: string) =>
      [...environment.matchAll(new RegExp(`(?<=\\s)${key}=(\\S*)(?=\\s|$)`, 'g'))].map(
        (match) => match[1] ?? '',
      )
    const marker = markerFromValues(
      values('CLAUDE_PID'),
      values('CLAUDE_CODE_SESSION_ID'),
    )
    if (marker !== undefined) markers.set(processId, marker)
  }
  return markers
}

function readProcessTable() {
  const result = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,lstart=,command='], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
  })
  const processes = processesFromPsOutput(result.stdout ?? '')
  if (!processes.has(process.pid)) {
    throw new Error(
      'cannot read the process table, so no process can be told apart from another session’s; no further process was killed',
    )
  }
  return processes
}

function readMarkers(processIds: number[]) {
  if (process.platform === 'linux') {
    const markers = new Map<number, Holder>()
    for (const processId of processIds) {
      try {
        const marker = markerFromProcFile(
          readFileSync(`/proc/${processId}/environ`, 'utf8'),
        )
        if (marker !== undefined) markers.set(processId, marker)
      } catch {}
    }
    return markers
  }
  const list = processIds.join(',')
  const listing = (extra: string[]) =>
    spawnSync('ps', [...extra, '-ww', '-o', 'pid=,command=', '-p', list], {
      encoding: 'utf8',
    }).stdout ?? ''
  return markersFromPsOutput(listing([]), listing(['-E']))
}

function processExists(processId: number) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Each process with its ownership, judged from one snapshot of the process
 * table. The sweeper's own marker counts only when it names a Claude Code
 * instance the sweeper runs under — a shell that merely inherited another
 * session's marker owns nothing. This process and its ancestors are never
 * candidates.
 */
function withOwnership<Candidate extends { processId: number }>(candidates: Candidate[]) {
  if (candidates.length === 0) return []
  const processes = readProcessTable()
  const own = new Set(lineage(processes, process.pid))
  const claimed = parseProcessId(process.env.CLAUDE_PID)
  const sweeper = claimed !== undefined && own.has(claimed) ? claimed : undefined
  const kept = candidates.filter((candidate) => !own.has(candidate.processId))
  if (kept.length === 0) return []
  const snapshot: ProcessSnapshot = {
    processes,
    markers: readMarkers([
      ...new Set(kept.flatMap((candidate) => lineage(processes, candidate.processId))),
    ]),
    processExists,
  }
  return kept.map((candidate) => ({
    ...candidate,
    ownership: classifyOwnership(candidate.processId, snapshot, sweeper),
  }))
}

export type { Ownership, ProcessSnapshot }
export {
  classifyOwnership,
  describeHolder,
  describeOwnership,
  isKillable,
  markerFromProcFile,
  markersFromPsOutput,
  processesFromPsOutput,
  withOwnership,
}
