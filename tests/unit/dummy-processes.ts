import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Long-lived node dummies that stand in for the processes a sweep or a
 * teardown meets: each runs from a chosen directory, carries or lacks a Claude
 * Code marker, and sits at a chosen place in the process tree — a child of the
 * test, an orphan whose starter is gone, or the child of a stand-in for
 * another Claude Code instance. Each carries a unique token on its command
 * line, and cleanup kills a pid only while that token is still there, so it
 * never reaches a process that merely inherited a recycled pid. Every dummy is
 * recorded the moment its pid is known, so a test that fails halfway still
 * leaves nothing running.
 */

type Dummy = { pid: number; token: string; line: string }

const started: Dummy[] = []

function record(dummy: Dummy) {
  started.push(dummy)
  return dummy
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

const RENAMED = `process.title = 'renamed-' + process.argv[1]
process.stdout.write('ready\\n')
setInterval(() => {}, 1000)`

const LAUNCHER = `const { spawn } = require('node:child_process')
const spec = JSON.parse(process.argv[2])
if (spec.mode === 'session') spec.environment.CLAUDE_PID = String(process.pid)
const child = spawn(spec.command[0], spec.command.slice(1), {
  cwd: spec.cwd,
  env: spec.environment,
  detached: spec.mode === 'orphan',
  stdio: ['ignore', 'pipe', 'ignore'],
})
child.stdout.once('data', (line) => {
  process.stdout.write(child.pid + ' ' + line)
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

function firstLine(
  command: string[],
  options: { cwd: string; environment: NodeJS.ProcessEnv },
) {
  const [executable = '', ...args] = command
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.environment,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return new Promise<{ pid: number; line: string }>((resolveLine, rejectLine) => {
    child.once('error', rejectLine)
    child.stdout.once('data', (data: Buffer) =>
      resolveLine({ pid: child.pid as number, line: data.toString().trim() }),
    )
  })
}

/** A dummy the test starts itself. */
async function spawnDummy(cwd: string, options: DummyOptions = {}): Promise<Dummy> {
  const token = newToken(options.label)
  const { pid, line } = await firstLine(nodeCommand(token, options.script), {
    cwd,
    environment: markedEnvironment(options.marker),
  })
  return record({ pid, token, line })
}

/**
 * Runs a launcher, from outside every lane, that starts the given command and
 * reports its pid and first line.
 */
async function launch(
  mode: 'orphan' | 'parent' | 'session',
  command: string[],
  options: { cwd: string; environment: NodeJS.ProcessEnv; launcher?: NodeJS.ProcessEnv },
) {
  const token = newToken()
  const { pid, line } = await firstLine(
    [
      process.execPath,
      '-e',
      LAUNCHER,
      token,
      JSON.stringify({
        mode,
        command,
        cwd: options.cwd,
        environment: options.environment,
      }),
    ],
    { cwd: tmpdir(), environment: options.launcher ?? markedEnvironment() },
  )
  const [childPid = '', ...rest] = line.split(' ')
  return {
    launcher: record({ pid, token, line }),
    childPid: Number(childPid),
    line: rest.join(' '),
  }
}

/**
 * A dummy whose starter already exited, so the system adopted it — what a
 * process left behind by an ended session looks like.
 */
async function spawnOrphan(cwd: string, options: DummyOptions = {}): Promise<Dummy> {
  const token = newToken(options.label)
  const { childPid, line } = await launch('orphan', nodeCommand(token, options.script), {
    cwd,
    environment: markedEnvironment(options.marker),
  })
  return record({ pid: childPid, token, line })
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
  const { launcher, childPid, line } = await launch(
    'session',
    nodeCommand(token, options.script),
    { cwd, environment: markedEnvironment({ sessionId }) },
  )
  return { session: launcher, child: record({ pid: childPid, token, line }) }
}

/**
 * A marked dummy and a child it started that renames itself — on macOS a
 * renamed process hides its environment from ps.
 */
async function spawnParentWithRenamedChild(cwd: string, marker: Marker) {
  const token = newToken()
  const environment = markedEnvironment(marker)
  const { launcher, childPid, line } = await launch(
    'parent',
    nodeCommand(token, RENAMED),
    { cwd, environment, launcher: environment },
  )
  return { parent: launcher, child: record({ pid: childPid, token, line }) }
}

/**
 * An orphan marked with the pid of a process that started after it — what a
 * recycled pid looks like. The shell waits for the marker and execs node with
 * it only once the later process exists; start times are whole seconds, hence
 * the pause between the two.
 */
async function spawnOrphanMarkedByLaterProcess(cwd: string, laterCwd: string) {
  const markerDirectory = mkdtempSync(join(tmpdir(), 'seasoned-skills-marker-'))
  const markerFile = join(markerDirectory, 'claude-pid')
  const token = newToken()
  try {
    const orphan = launch(
      'orphan',
      [
        '/bin/sh',
        '-c',
        'until [ -s "$0" ]; do sleep 0.1; done; CLAUDE_PID=$(cat "$0") exec "$@"',
        markerFile,
        ...nodeCommand(token),
      ],
      { cwd, environment: markedEnvironment() },
    )
    await new Promise((resolvePause) => setTimeout(resolvePause, 1100))
    const later = await spawnDummy(laterCwd)
    writeFileSync(markerFile, String(later.pid))
    const { childPid, line } = await orphan
    return { dummy: record({ pid: childPid, token, line }), later }
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

function isRunning(dummy: Dummy) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(dummy.pid)], {
      encoding: 'utf8',
    }).includes(dummy.token)
  } catch {
    return false
  }
}

async function exits(dummy: Dummy, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (isRunning(dummy)) {
    if (Date.now() > deadline) return false
    await new Promise((resolvePause) => setTimeout(resolvePause, 50))
  }
  return true
}

/** Kills every dummy this test file started that still runs. */
function stopDummies() {
  for (const dummy of started.splice(0)) {
    if (!isRunning(dummy)) continue
    try {
      process.kill(dummy.pid, 'SIGKILL')
    } catch {}
  }
}

export type { Dummy }
export {
  endedProcessId,
  exits,
  isRunning,
  LISTEN,
  spawnDummy,
  spawnOrphan,
  spawnOrphanMarkedByLaterProcess,
  spawnParentWithRenamedChild,
  spawnSessionWithChild,
  stopDummies,
}
