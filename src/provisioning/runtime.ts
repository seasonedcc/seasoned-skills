import { spawnSync } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { dirname } from 'node:path'
import pg from 'pg'
import { withDatabaseName } from './common.js'

/**
 * Side-effecting helpers the provisioning flows share: git, shell steps,
 * Postgres admin connections, port probes, and the cache-store flush. Nothing
 * here kills a process — the only kills in this package live in teardown and
 * the lane-process sweep, and both act on exact process ids after listing.
 */

function log(message: string) {
  console.error(`[provision] ${message}`)
}

function git(args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync('git', args, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.trim()}`)
  }
  return result.stdout.trim()
}

function gitSucceeds(args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync('git', args, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    encoding: 'utf8',
  })
  return result.status === 0
}

/**
 * Run a configured step (a shell command string from the resource table) in a
 * lane, with the lane's allocation in the environment.
 */
function runStep(
  command: string,
  options: { cwd: string; env?: Record<string, string> },
) {
  log(`running: ${command}`)
  const environment = {
    ...process.env,
    DOTENV_CONFIG_PATH: undefined,
    ...options.env,
  }
  const result = spawnSync(command, {
    cwd: options.cwd,
    shell: true,
    stdio: ['ignore', 2, 2],
    env: environment,
  })
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`)
  }
}

function resolveMainRepository(startDirectory: string) {
  const gitCommonDirectory = git(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: startDirectory },
  )
  return dirname(gitCommonDirectory)
}

async function withAdminClient<T>(
  databaseUrl: string,
  callback: (client: pg.Client) => Promise<T>,
) {
  const client = new pg.Client({
    connectionString: withDatabaseName(databaseUrl, 'postgres'),
  })
  await client.connect()
  try {
    return await callback(client)
  } finally {
    await client.end()
  }
}

/**
 * Wait until the Postgres server answers, failing loudly on timeout so
 * callers never mistake "server down" for "database absent".
 */
async function waitForDatabaseServer(databaseUrl: string, timeoutSeconds = 30) {
  const deadline = Date.now() + timeoutSeconds * 1000
  for (;;) {
    try {
      await withAdminClient(databaseUrl, async (client) => {
        await client.query('select 1')
      })
      return
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(
          `cannot reach the Postgres server behind ${databaseUrl.replace(/\/[^/]*$/, '')} — is it running? (${(error as Error).message})`,
        )
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
    }
  }
}

/** Whether this process could bind the port — used when allocating a plan. */
function isPortFree(port: number) {
  return new Promise<boolean>((resolvePort) => {
    const server = createServer()
    server.once('error', () => resolvePort(false))
    server.listen({ port, host: '127.0.0.1' }, () =>
      server.close(() => resolvePort(true)),
    )
  })
}

/**
 * Whether something is serving the port — a TCP connect probe, not lsof:
 * unprivileged lsof cannot see other users' sockets, so a root-owned listener
 * would read as absent and a service start would then fail on the bind.
 */
function isPortListening(port: number, timeoutMilliseconds = 500) {
  return new Promise<boolean>((resolveProbe) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    const finish = (listening: boolean) => {
      socket.destroy()
      resolveProbe(listening)
    }
    socket.setTimeout(timeoutMilliseconds, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

/**
 * Flush a lane's cache-store database. Indexes recycle across lanes, and a
 * recycled index carries the previous tenant's keys and queue backlogs unless
 * flushed. The caller guards which URLs are flushable; this never runs
 * against an index-less URL.
 */
function flushCacheStore(url: string) {
  const probe = spawnSync('redis-cli', ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    log(
      `WARNING: redis-cli not found — ${url} not flushed and may carry a previous lane's keys`,
    )
    return
  }
  const result = spawnSync('redis-cli', ['-u', url, 'flushdb'], {
    encoding: 'utf8',
  })
  if (result.status === 0) {
    log(`flushed cache-store database ${url}`)
  } else {
    log(`WARNING: could not flush cache-store database ${url}`)
  }
}

/** The pids listening on a TCP port, via lsof. */
function portListenerProcessIds(port: number) {
  const result = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  })
  if (result.status !== 0) return []
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

/** A process's working directory, via lsof — empty when it cannot be told. */
function processWorkingDirectory(processId: number) {
  const result = spawnSync('lsof', ['-a', '-p', String(processId), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  })
  if (result.status !== 0) return ''
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('n')) return line.slice(1)
  }
  return ''
}

function commandLine(processId: number) {
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(processId)], {
    encoding: 'utf8',
  })
  return result.stdout?.trim() ?? ''
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

export {
  commandLine,
  flushCacheStore,
  git,
  gitSucceeds,
  isPortFree,
  isPortListening,
  log,
  ownProcessIds,
  portListenerProcessIds,
  processWorkingDirectory,
  resolveMainRepository,
  runStep,
  waitForDatabaseServer,
  withAdminClient,
}
