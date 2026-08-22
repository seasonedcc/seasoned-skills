import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  APP_ENV_FILE,
  APP_TEST_ENV_FILE,
  databaseNameFromUrl,
  isWorktreeDatabaseName,
  laneSlug,
  readEnvValues,
  WORKTREE_DATABASE_PREFIX,
  WORKTREES_DIRECTORY_NAME,
  withDatabaseName,
} from './common'
import {
  git,
  gitSucceeds,
  log,
  readStdinJson,
  resolveMainRepository,
  withAdminClient,
} from './runtime'

function readEnvFileValues(path: string) {
  if (!existsSync(path)) return {}
  return readEnvValues(readFileSync(path, 'utf8'))
}

function killPortListeners(ports: number[]) {
  for (const port of ports) {
    if (!Number.isFinite(port) || port <= 0) continue
    const result = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    })
    if (result.status !== 0) continue
    for (const pid of result.stdout.split('\n').filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGTERM')
      } catch {
        continue
      }
      log(`terminated process ${pid} listening on port ${port}`)
    }
  }
}

async function dropDatabase(databaseUrl: string) {
  const name = databaseNameFromUrl(databaseUrl)
  if (!isWorktreeDatabaseName(name)) {
    log(
      `refusing to drop "${name}" (not a ${WORKTREE_DATABASE_PREFIX}* database)`
    )
    return
  }
  await withAdminClient(databaseUrl, async (client) => {
    await client.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name]
    )
    await client.query(`drop database if exists "${name}"`)
  })
  log(`dropped database ${name}`)
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      hook: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  const mainRepository = resolveMainRepository()

  let worktreePath: string
  if (values.hook) {
    const input = await readStdinJson()
    const inputPath =
      input.worktree_path ||
      (input.worktree_id &&
        join(
          dirname(mainRepository),
          WORKTREES_DIRECTORY_NAME,
          input.worktree_id
        ))
    if (!inputPath) {
      log('WorktreeRemove hook input had no worktree path; nothing to clean up')
      return
    }
    worktreePath = resolve(inputPath)
  } else {
    const lane = positionals[0]
    if (!lane) {
      throw new Error('usage: pnpm run worktree:teardown <lane|path> [--force]')
    }
    worktreePath = existsSync(lane)
      ? resolve(lane)
      : resolve(dirname(mainRepository), WORKTREES_DIRECTORY_NAME, lane)
  }

  const envValues = readEnvFileValues(join(worktreePath, APP_ENV_FILE))
  const testEnvValues = readEnvFileValues(join(worktreePath, APP_TEST_ENV_FILE))

  killPortListeners(
    [envValues, testEnvValues]
      .flatMap((fileValues) => [
        fileValues.PORT,
        fileValues.HMR_PORT,
        fileValues.MAILDEV_PORT,
        fileValues.MAILDEV_WEB_PORT,
      ])
      .filter((port): port is string => Boolean(port))
      .map(Number)
  )

  const adminUrl =
    envValues.DATABASE_URL ??
    testEnvValues.DATABASE_URL ??
    readEnvFileValues(join(mainRepository, APP_ENV_FILE)).DATABASE_URL
  if (adminUrl) {
    const lanePrefix = `${WORKTREE_DATABASE_PREFIX}${laneSlug(basename(worktreePath))}_`
    const worktreesDirectory = join(
      dirname(mainRepository),
      WORKTREES_DIRECTORY_NAME
    )
    const registeredPaths = git(['worktree', 'list', '--porcelain'], {
      cwd: mainRepository,
    })
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => resolve(line.slice('worktree '.length)))
    const lingeringPaths = existsSync(worktreesDirectory)
      ? readdirSync(worktreesDirectory).map((entry) =>
          join(worktreesDirectory, entry)
        )
      : []
    const otherLanePrefixes = [...registeredPaths, ...lingeringPaths]
      .filter((path) => path !== mainRepository && path !== worktreePath)
      .map((path) => `${WORKTREE_DATABASE_PREFIX}${laneSlug(basename(path))}_`)
    const discovered = await withAdminClient(adminUrl, async (client) => {
      const result = await client.query<{ datname: string }>(
        'select datname from pg_database where starts_with(datname, $1)',
        [lanePrefix]
      )
      return result.rows.map((row) => row.datname)
    })
    const databaseNames = new Set([
      ...[envValues.DATABASE_URL, testEnvValues.DATABASE_URL]
        .filter((url): url is string => Boolean(url))
        .map(databaseNameFromUrl),
      ...discovered.filter(
        (name) => !otherLanePrefixes.some((prefix) => name.startsWith(prefix))
      ),
    ])
    for (const name of databaseNames) {
      await dropDatabase(withDatabaseName(adminUrl, name))
    }
  } else {
    log('no DATABASE_URL available; skipping database cleanup')
  }

  if (!values.hook) {
    const registered = git(['worktree', 'list', '--porcelain'], {
      cwd: mainRepository,
    })
      .split('\n')
      .some((line) => line === `worktree ${worktreePath}`)
    if (registered) {
      const dirty =
        existsSync(worktreePath) &&
        git(['status', '--porcelain'], { cwd: worktreePath }) !== ''
      if (dirty && !values.force) {
        throw new Error(
          `worktree at ${worktreePath} has uncommitted changes; re-run with --force to remove it anyway`
        )
      }
      git(['worktree', 'remove', '--force', worktreePath], {
        cwd: mainRepository,
      })
      log(`removed worktree at ${worktreePath}`)
    } else {
      gitSucceeds(['worktree', 'prune'], { cwd: mainRepository })
      log(`no worktree registered at ${worktreePath}`)
    }
  }

  log(`teardown complete for ${basename(worktreePath)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(process.argv.includes('--hook') ? 0 : 1)
})
