import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import pg from 'pg'
import {
  type ProcessWorkingDirectory,
  withDatabaseName,
  workingDirectoriesFromLsofOutput,
} from './common.js'

/**
 * Side-effecting helpers the provisioning flows share: git, shell steps,
 * Postgres admin connections, port probes, process listings, and the
 * cache-store flush. Nothing here kills a process — the only kills in this
 * package live in teardown, the lane-process sweep, and the browser sweep,
 * and each acts on exact process ids after listing, only where the process
 * ownership rule allows.
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

const LISTEN_STATE = '0A'

/** The inodes of the sockets listening on a port, from a /proc/net TCP table. */
function listeningSocketInodes(table: string, port: number) {
  return table
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const columns = line.trim().split(/\s+/)
      const localAddress = columns[1] ?? ''
      const state = columns[3]
      const inode = columns[9]
      const localPort = Number.parseInt(localAddress.split(':').at(-1) ?? '', 16)
      return state === LISTEN_STATE && localPort === port && inode !== undefined
        ? [inode]
        : []
    })
}

function procTcpTable(procRoot: string, table: string) {
  try {
    return readFileSync(join(procRoot, 'net', table), 'utf8')
  } catch {
    return ''
  }
}

function isOwnedBy(processDirectory: string, userId: number) {
  try {
    return statSync(processDirectory).uid === userId
  } catch {
    return false
  }
}

function descriptorPaths(processDirectory: string) {
  const descriptors = join(processDirectory, 'fd')
  try {
    return readdirSync(descriptors).map((descriptor) => join(descriptors, descriptor))
  } catch {
    return []
  }
}

/** The inode of the socket a descriptor holds — absent once it closed. */
function socketInode(descriptorPath: string) {
  try {
    return readlinkSync(descriptorPath).match(/^socket:\[(\d+)\]$/)?.[1]
  } catch {
    return undefined
  }
}

/**
 * The pids of one user's processes listening on a TCP port, read from /proc:
 * the listening sockets' inodes from the TCP tables, then each process whose
 * open descriptors hold one. Processes and descriptors that vanish or cannot
 * be read are passed over.
 */
function portListenerProcessIdsFromProc(procRoot: string, port: number, userId: number) {
  const inodes = new Set(
    ['tcp', 'tcp6'].flatMap((table) =>
      listeningSocketInodes(procTcpTable(procRoot, table), port),
    ),
  )
  if (inodes.size === 0) return []
  return procProcessIds(procRoot).filter((processId) => {
    const directory = join(procRoot, String(processId))
    return (
      isOwnedBy(directory, userId) &&
      descriptorPaths(directory).some((descriptorPath) =>
        inodes.has(socketInode(descriptorPath) ?? ''),
      )
    )
  })
}

/**
 * The pids listening on a TCP port. Linux reads /proc, because its lsof
 * leaves out every process whose name holds a parenthesis — a Next.js server
 * names itself `next-server (v15.0.0)`; macOS asks lsof.
 */
function portListenerProcessIds(port: number) {
  if (process.platform === 'linux') {
    return portListenerProcessIdsFromProc('/proc', port, userInfo().uid)
  }
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

/** A process's working directory — empty when it cannot be told. */
function processWorkingDirectory(processId: number) {
  if (process.platform === 'linux') {
    try {
      return readlinkSync(`/proc/${processId}/cwd`)
    } catch {
      return ''
    }
  }
  const result = spawnSync('lsof', ['-a', '-p', String(processId), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  })
  if (result.status !== 0) return ''
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('n')) return line.slice(1)
  }
  return ''
}

function procProcessIds(procRoot: string) {
  return readdirSync(procRoot)
    .filter((entry) => /^[1-9]\d*$/.test(entry))
    .map(Number)
}

function hasVanished(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ESRCH'
}

/**
 * Every process of one user with its working directory, read from /proc.
 * Processes that vanish are passed over; one of the user's processes that
 * cannot be read, or a /proc that cannot be read at all, throws rather than
 * leaving the listing short.
 */
function processWorkingDirectoriesFromProc(procRoot: string, userId: number) {
  const entries: ProcessWorkingDirectory[] = []
  for (const processId of procProcessIds(procRoot)) {
    const directory = join(procRoot, String(processId))
    try {
      if (statSync(directory).uid !== userId) continue
      entries.push({ processId, workingDirectory: readlinkSync(join(directory, 'cwd')) })
    } catch (error) {
      if (hasVanished(error)) continue
      throw new Error(
        `could not read the working directory of process ${processId}: ${(error as Error).message}`,
      )
    }
  }
  return entries
}

/**
 * Every process of this user with its working directory, through lsof. lsof
 * exits 1 both when nothing matched and on errors, and only errors explain
 * themselves on stderr once its warnings are silenced — so a listing lsof
 * could not make throws rather than reading as no processes at all.
 */
function processWorkingDirectoriesFromLsof() {
  const result = spawnSync(
    'lsof',
    ['-w', '-a', '-u', userInfo().username, '-d', 'cwd', '-F', 'pn'],
    { encoding: 'utf8' },
  )
  if (result.status === 0 || (result.status === 1 && result.stderr === '')) {
    return workingDirectoriesFromLsofOutput(result.stdout)
  }
  const reason =
    result.error?.message ??
    (result.stderr.trim() ||
      (result.signal ? `killed by ${result.signal}` : `exit status ${result.status}`))
  throw new Error(`lsof could not list the processes' working directories: ${reason}`)
}

/**
 * Every process of this user with its working directory, whatever its name.
 * Linux reads /proc, because its lsof leaves out every process whose name
 * holds a parenthesis; macOS asks lsof. Throws when the processes cannot be
 * listed.
 */
function processWorkingDirectories() {
  return process.platform === 'linux'
    ? processWorkingDirectoriesFromProc('/proc', userInfo().uid)
    : processWorkingDirectoriesFromLsof()
}

function commandLine(processId: number) {
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(processId)], {
    encoding: 'utf8',
  })
  return result.stdout?.trim() ?? ''
}

export {
  commandLine,
  flushCacheStore,
  git,
  gitSucceeds,
  isPortFree,
  isPortListening,
  log,
  portListenerProcessIds,
  portListenerProcessIdsFromProc,
  processWorkingDirectories,
  processWorkingDirectoriesFromLsof,
  processWorkingDirectoriesFromProc,
  processWorkingDirectory,
  resolveMainRepository,
  runStep,
  waitForDatabaseServer,
  withAdminClient,
}
