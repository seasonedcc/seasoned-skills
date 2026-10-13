import { type ChildProcess, spawn } from 'node:child_process'

/**
 * Long-lived node dummies that stand in for the processes a sweep or a
 * teardown meets: each runs from a chosen directory and carries, or lacks, a
 * Claude Code marker. A dummy marked with another dummy's pid stands in for a
 * process another Claude Code instance started. Every dummy is a child of the
 * test, so cleanup kills only these exact children.
 */

const holdOpen = "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"

function unmarkedEnvironment() {
  const environment = { ...process.env }
  delete environment.CLAUDE_PID
  delete environment.CLAUDE_CODE_SESSION_ID
  return environment
}

function whenReady(child: ChildProcess) {
  return new Promise<ChildProcess>((resolveChild, rejectChild) => {
    child.once('error', rejectChild)
    child.stdout?.once('data', () => resolveChild(child))
  })
}

function spawnDummy(
  cwd: string,
  marker: { claudeProcessId?: number; sessionId?: string } = {},
) {
  const environment = unmarkedEnvironment()
  if (marker.claudeProcessId !== undefined) {
    environment.CLAUDE_PID = String(marker.claudeProcessId)
  }
  if (marker.sessionId !== undefined) {
    environment.CLAUDE_CODE_SESSION_ID = marker.sessionId
  }
  return whenReady(
    spawn(process.execPath, ['-e', holdOpen], {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  )
}

/**
 * A dummy marked with the pid of a process that started after it — what a
 * recycled pid looks like. The shell forks first and execs node with the
 * marker only once the later process exists; start times are whole seconds,
 * hence the pause between the two.
 */
async function spawnDummyMarkedByLaterProcess(cwd: string, laterCwd: string) {
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      'read claude; export CLAUDE_PID="$claude"; exec "$0" -e "$1"',
      process.execPath,
      holdOpen,
    ],
    { cwd, env: unmarkedEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] },
  )
  await new Promise((resolvePause) => setTimeout(resolvePause, 1100))
  const later = await spawnDummy(laterCwd)
  child.stdin?.write(`${later.pid}\n`)
  return { dummy: await whenReady(child), later }
}

/** The pid of a process that already ran and exited. */
async function endedProcessId() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise((resolveExit) => child.once('exit', resolveExit))
  return child.pid as number
}

function isRunning(child: ChildProcess) {
  return child.exitCode === null && child.signalCode === null
}

function exits(child: ChildProcess, timeoutMilliseconds = 10_000) {
  if (!isRunning(child)) return Promise.resolve(true)
  return new Promise<boolean>((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMilliseconds)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit(true)
    })
  })
}

function stopDummies(children: ChildProcess[]) {
  for (const child of children) {
    if (isRunning(child)) child.kill('SIGKILL')
  }
  children.length = 0
}

export {
  endedProcessId,
  exits,
  isRunning,
  spawnDummy,
  spawnDummyMarkedByLaterProcess,
  stopDummies,
}
