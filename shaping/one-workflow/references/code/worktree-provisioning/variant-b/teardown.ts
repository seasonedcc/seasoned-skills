import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  WORKTREES_DIRECTORY_NAME,
  WORKTREE_DATABASE_PREFIX,
  databaseNameFromUrl,
  databaseNames,
  isWorktreeDatabaseName,
  laneSlug,
  portsClaimedByEnvFile,
  readEnvValues,
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

// The lane's test database breeds derived ones the env files never name: the
// E2E suite clones it once per Playwright worker, and the unit suite derives
// per-file databases from it. Teardown asks Postgres which ones exist rather
// than trying to name them.
async function derivedDatabaseUrls(testDatabaseUrl: string) {
  const canonical = databaseNameFromUrl(testDatabaseUrl)

  return await withAdminClient(testDatabaseUrl, async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      'select datname from pg_database where datname like $1 or datname like $2',
      [`${canonical}\\_w%`, `${canonical}\\_unit%`]
    )

    return rows.map(({ datname }) => withDatabaseName(testDatabaseUrl, datname))
  })
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

  const envValues = readEnvFileValues(join(worktreePath, '.env'))
  const testEnvValues = readEnvFileValues(join(worktreePath, '.env.test'))

  killPortListeners([
    ...portsClaimedByEnvFile('.env', envValues),
    ...portsClaimedByEnvFile('.env.test', testEnvValues),
  ])

  const testDatabaseUrl = testEnvValues.DATABASE_URL
  const databaseUrls = [envValues.DATABASE_URL, testDatabaseUrl].filter(
    (url): url is string => Boolean(url)
  )
  if (testDatabaseUrl) {
    databaseUrls.push(...(await derivedDatabaseUrls(testDatabaseUrl)))
  }
  if (databaseUrls.length === 0) {
    const names = databaseNames(laneSlug(basename(worktreePath)))
    const mainDatabaseUrl = readEnvFileValues(
      join(mainRepository, '.env')
    ).DATABASE_URL
    if (mainDatabaseUrl) {
      databaseUrls.push(
        withDatabaseName(mainDatabaseUrl, names.development),
        withDatabaseName(mainDatabaseUrl, names.test),
        withDatabaseName(mainDatabaseUrl, `${names.test}_unit`)
      )
    }
  }
  for (const databaseUrl of databaseUrls) {
    await dropDatabase(databaseUrl)
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
