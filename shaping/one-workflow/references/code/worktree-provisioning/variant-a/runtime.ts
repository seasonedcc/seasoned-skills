import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import pg from 'pg'
import { withDatabaseName } from './common'

function log(message: string) {
  console.error(`[worktree] ${message}`)
}

function git(args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync('git', args, { cwd: options.cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

function gitSucceeds(args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync('git', args, { cwd: options.cwd, encoding: 'utf8' })
  return result.status === 0
}

function runStep(
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
) {
  log(`running: ${command} ${args.join(' ')}`)
  const environment = {
    ...process.env,
    DOTENV_CONFIG_PATH: undefined,
    ...options.env,
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: ['ignore', 2, 2],
    env: environment,
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}`
    )
  }
}

async function readStdinJson() {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  if (!data.trim()) return {}
  return JSON.parse(data) as Record<string, string | undefined>
}

function resolveMainRepository() {
  const gitCommonDirectory = git([
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  return dirname(gitCommonDirectory)
}

async function withAdminClient<T>(
  databaseUrl: string,
  callback: (client: pg.Client) => Promise<T>
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

export {
  git,
  gitSucceeds,
  log,
  readStdinJson,
  resolveMainRepository,
  runStep,
  withAdminClient,
}
