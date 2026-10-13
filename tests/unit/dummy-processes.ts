import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/**
 * Long-lived node dummies that stand in for the processes a sweep or a
 * teardown meets: each runs from a chosen directory, carries or lacks a Claude
 * Code marker, and sits at a chosen place in the process tree — a child of the
 * test, an orphan whose starter is gone, or the child of a stand-in for
 * another Claude Code instance. Each carries a unique token on its command
 * line, which a renamed dummy keeps in its new name, and cleanup kills a pid
 * only while that token is still there, so it never reaches a process that
 * merely inherited a recycled pid. Every process a helper starts is recorded
 * the moment its pid is known, before anything waits on it, and every wait
 * inside a dummy is bounded, so a test that fails halfway still leaves
 * nothing running. The recorded processes still carrying their token are the
 * only ones a test may signal.
 */

type Tracked = { pid: number; token: string }

type Dummy = Tracked & { line: string }

const tracked: Tracked[] = []

function track(pid: number, token: string): Tracked {
  const entry = { pid, token }
  tracked.push(entry)
  return entry
}

/** Whether a pid belongs to a process this test file started and that still runs. */
function isTrackedAndRunning(processId: number) {
  return tracked.some((entry) => entry.pid === processId && isRunning(entry))
}

type Marker = { claudeProcessId?: number; sessionId?: string }

type DummyOptions = {
  marker?: Marker
  /** Node code the dummy runs; it signals readiness with its first output line. */
  script?: string
  /** A word for the dummy's command line, for sweeps that match on it. */
  label?: string
}

const HOLD_OPEN = "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"

const LISTEN = `const server = require('node:net').createServer()
server.listen(0, '127.0.0.1', () => process.stdout.write(server.address().port + '\\n'))
setInterval(() => {}, 1000)`

const RENAME_LIKE_NEXT_SERVER =
  "process.title = 'next-server (v15.0.0) ' + process.argv[1]"

const RENAMED_LISTENER = `${RENAME_LIKE_NEXT_SERVER}
${LISTEN}`

const RENAMED = `${RENAME_LIKE_NEXT_SERVER}
${HOLD_OPEN}`

const LAUNCHER = `const { spawn } = require('node:child_process')
const spec = JSON.parse(process.env.DUMMY_LAUNCH)
if (spec.mode === 'session') spec.environment.CLAUDE_PID = String(process.pid)
const child = spawn(spec.command[0], spec.command.slice(1), {
  cwd: spec.cwd,
  env: spec.environment,
  detached: spec.mode === 'orphan',
  stdio: ['ignore', 'pipe', 'ignore'],
})
process.stdout.write(child.pid + '\\n')
child.stdout.once('data', (line) => {
  process.stdout.write(line)
  if (spec.mode === 'orphan') {
    child.stdout.destroy()
    child.unref()
  }
})
if (spec.mode !== 'orphan') setInterval(() => {}, 1000)`

function markedEnvironment(marker: Marker = {}) {
  const environment = { ...process.env }
  delete environment.CLAUDE_PID
  delete environment.CLAUDE_CODE_SESSION_ID
  if (marker.claudeProcessId !== undefined) {
    environment.CLAUDE_PID = String(marker.claudeProcessId)
  }
  if (marker.sessionId !== undefined)
    environment.CLAUDE_CODE_SESSION_ID = marker.sessionId
  return environment
}

function newToken(label?: string) {
  return [label, `dummy-${randomUUID()}`].filter(Boolean).join('-')
}

function nodeCommand(token: string, script = HOLD_OPEN) {
  return [process.execPath, '-e', script, token]
}

/** Reads a child's output one line at a time; a child that stops reporting rejects. */
function lineReader(child: ChildProcess) {
  const lines = createInterface({ input: child.stdout as NodeJS.ReadableStream })[
    Symbol.asyncIterator
  ]()
  return async () => {
    const next = await lines.next()
    if (next.done) throw new Error(`process ${child.pid} exited before it reported`)
    return String(next.value).trim()
  }
}

/** Starts a command the test owns, recorded before anything waits on it. */
function start(
  command: string[],
  token: string,
  options: { cwd: string; environment: NodeJS.ProcessEnv },
) {
  const [executable = '', ...args] = command
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.environment,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (child.pid === undefined) throw new Error(`could not start ${executable}`)
  return { started: track(child.pid, token), nextLine: lineReader(child) }
}

/** A dummy the test starts itself. */
async function spawnDummy(cwd: string, options: DummyOptions = {}): Promise<Dummy> {
  const token = newToken(options.label)
  const { started, nextLine } = start(nodeCommand(token, options.script), token, {
    cwd,
    environment: markedEnvironment(options.marker),
  })
  return { ...started, line: await nextLine() }
}

/**
 * Runs an unmarked launcher, from outside every lane, that starts the given
 * command — whose command line carries the given token — and reports first
 * its pid, then its first line.
 */
async function launch(
  mode: 'orphan' | 'parent' | 'session',
  command: string[],
  token: string,
  options: { cwd: string; environment: NodeJS.ProcessEnv },
) {
  const launcherToken = newToken()
  const { started: launcher, nextLine } = start(
    [process.execPath, '-e', LAUNCHER, launcherToken],
    launcherToken,
    {
      cwd: tmpdir(),
      environment: {
        ...markedEnvironment(),
        DUMMY_LAUNCH: JSON.stringify({
          mode,
          command,
          cwd: options.cwd,
          environment: options.environment,
        }),
      },
    },
  )
  const child = track(Number(await nextLine()), token)
  return { launcher, child, nextLine }
}

/**
 * A dummy whose starter already exited, so the system adopted it — what a
 * process left behind by an ended session looks like.
 */
async function spawnOrphan(cwd: string, options: DummyOptions = {}): Promise<Dummy> {
  const token = newToken(options.label)
  const { child, nextLine } = await launch(
    'orphan',
    nodeCommand(token, options.script),
    token,
    { cwd, environment: markedEnvironment(options.marker) },
  )
  return { ...child, line: await nextLine() }
}

/**
 * A stand-in for another live Claude Code instance and a dummy it started,
 * marked with the stand-in's pid and the given session.
 */
async function spawnSessionWithChild(
  cwd: string,
  sessionId: string,
  options: Omit<DummyOptions, 'marker'> = {},
) {
  const token = newToken(options.label)
  const { launcher, child, nextLine } = await launch(
    'session',
    nodeCommand(token, options.script),
    token,
    { cwd, environment: markedEnvironment({ sessionId }) },
  )
  return { session: launcher, child: { ...child, line: await nextLine() } }
}

/**
 * An unmarked dummy and an unmarked child it started that renames itself the
 * way a Next.js server does — on Linux, lsof never lists a process whose
 * name holds a parenthesis, and on macOS a renamed process hides its
 * environment from ps. Only its ancestry can tell its owner.
 */
async function spawnParentWithRenamedChild(cwd: string) {
  const token = newToken()
  const { launcher, child, nextLine } = await launch(
    'parent',
    nodeCommand(token, RENAMED),
    token,
    { cwd, environment: markedEnvironment() },
  )
  return { parent: launcher, child: { ...child, line: await nextLine() } }
}

/**
 * An orphan marked with the pid of a process that started after it — what a
 * recycled pid looks like. The shell waits, for at most 30 seconds, for the
 * marker and execs node with it only once the later process exists. Start
 * times are whole seconds, so the later process starts more than a second
 * after the shell is known to run.
 */
async function spawnOrphanMarkedByLaterProcess(cwd: string, laterCwd: string) {
  const markerDirectory = mkdtempSync(join(tmpdir(), 'seasoned-skills-marker-'))
  const markerFile = join(markerDirectory, 'claude-pid')
  const token = newToken()
  try {
    const { child, nextLine } = await launch(
      'orphan',
      [
        '/bin/sh',
        '-c',
        'n=0; until [ -s "$0" ]; do n=$((n + 1)); [ "$n" -le 300 ] || exit 1; sleep 0.1; done; CLAUDE_PID=$(cat "$0") exec "$@"',
        markerFile,
        ...nodeCommand(token),
      ],
      token,
      { cwd, environment: markedEnvironment() },
    )
    await new Promise((resolvePause) => setTimeout(resolvePause, 1100))
    const later = await spawnDummy(laterCwd)
    writeFileSync(markerFile, String(later.pid))
    return { dummy: { ...child, line: await nextLine() }, later }
  } finally {
    rmSync(markerDirectory, { recursive: true, force: true })
  }
}

/** The pid of a process that already ran and exited. */
async function endedProcessId() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise((resolveExit) => child.once('exit', resolveExit))
  return child.pid as number
}

/** The real ps, resolved before any test puts a stand-in on PATH. */
const PS = execFileSync('/bin/sh', ['-c', 'command -v ps'], { encoding: 'utf8' }).trim()

function isRunning(entry: Tracked) {
  try {
    return execFileSync(PS, ['-o', 'command=', '-p', String(entry.pid)], {
      encoding: 'utf8',
    }).includes(entry.token)
  } catch {
    return false
  }
}

async function exits(entry: Tracked, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (isRunning(entry)) {
    if (Date.now() > deadline) return false
    await new Promise((resolvePause) => setTimeout(resolvePause, 50))
  }
  return true
}

/** Kills every process this test file started that still runs. */
function stopDummies() {
  for (const entry of tracked) {
    if (!isRunning(entry)) continue
    try {
      process.kill(entry.pid, 'SIGKILL')
    } catch {}
  }
  tracked.splice(0)
}

export type { Dummy }
export {
  endedProcessId,
  exits,
  isRunning,
  isTrackedAndRunning,
  LISTEN,
  RENAMED_LISTENER,
  spawnDummy,
  spawnOrphan,
  spawnOrphanMarkedByLaterProcess,
  spawnParentWithRenamedChild,
  spawnSessionWithChild,
  stopDummies,
}
