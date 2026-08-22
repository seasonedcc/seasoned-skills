import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { environmentSchema as appEnvironmentSchema } from '../../app/env.server'
import { environmentSchema as frameworkEnvironmentSchema } from '../../app/framework/env.server'
import {
  E2E_WORKER_COUNT,
  ENV_FILE_NAMES,
  ENV_MARKER,
  type PortPlan,
  WORKTREES_DIRECTORY_NAME,
  bucketName,
  databaseNameFromUrl,
  databaseNames,
  laneSlug,
  missingEnvKeys,
  readEnvValues,
  repointLocalhostUrls,
  reservedPortsFromEnvFiles,
  resolvePortPlan,
  upsertEnvValues,
  withDatabaseName,
  worktreePathsFromPorcelain,
} from './common'
import {
  git,
  gitSucceeds,
  log,
  readStdinJson,
  resolveMainRepository,
  runStep,
  withAdminClient,
} from './runtime'

function isPortFree(port: number) {
  return new Promise<boolean>((resolvePort) => {
    const server = createServer()
    server.once('error', () => resolvePort(false))
    server.listen({ port, host: '127.0.0.1' }, () =>
      server.close(() => resolvePort(true))
    )
  })
}

function collectReservedPorts(
  mainRepository: string,
  currentWorktreePath: string
) {
  const listing = git(['worktree', 'list', '--porcelain'], {
    cwd: mainRepository,
  })
  const envFiles = worktreePathsFromPorcelain(
    listing,
    currentWorktreePath
  ).flatMap((worktreePath) =>
    ENV_FILE_NAMES.map((envFile) => {
      const envPath = join(worktreePath, envFile)
      return {
        envFile,
        contents: existsSync(envPath) ? readFileSync(envPath, 'utf8') : null,
      }
    })
  )
  return reservedPortsFromEnvFiles(envFiles)
}

function defaultBaseReference(mainRepository: string) {
  if (gitSucceeds(['fetch', 'origin', 'main'], { cwd: mainRepository })) {
    return 'origin/main'
  }
  log('could not fetch origin/main; falling back to the local main branch')
  return 'main'
}

function ensureWorktree({
  mainRepository,
  worktreePath,
  branchName,
  baseReference,
}: {
  mainRepository: string
  worktreePath: string
  branchName: string
  baseReference: string
}) {
  const registered = git(['worktree', 'list', '--porcelain'], {
    cwd: mainRepository,
  })
    .split('\n')
    .some((line) => line === `worktree ${worktreePath}`)
  if (registered) {
    log(`worktree already registered at ${worktreePath}`)
    return
  }
  if (existsSync(worktreePath)) {
    throw new Error(
      `${worktreePath} exists but is not a registered worktree; remove it or pick another lane name`
    )
  }
  if (
    gitSucceeds(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`],
      {
        cwd: mainRepository,
      }
    )
  ) {
    git(['worktree', 'add', worktreePath, branchName], { cwd: mainRepository })
    log(`created worktree at ${worktreePath} on existing branch ${branchName}`)
    return
  }
  git(['worktree', 'add', '-b', branchName, worktreePath, baseReference], {
    cwd: mainRepository,
  })
  log(
    `created worktree at ${worktreePath} on new branch ${branchName} from ${baseReference}`
  )
}

async function ensureDatabase(databaseUrl: string) {
  const name = databaseNameFromUrl(databaseUrl)
  return withAdminClient(databaseUrl, async (client) => {
    const existing = await client.query(
      'select 1 from pg_database where datname = $1',
      [name]
    )
    if (existing.rowCount) {
      log(`database ${name} already exists`)
      return false
    }
    await client.query(`create database "${name}"`)
    log(`created database ${name}`)
    return true
  })
}

function provisionEnvFiles({
  mainRepository,
  worktreePath,
  slug,
  plan,
}: {
  mainRepository: string
  worktreePath: string
  slug: string
  plan: PortPlan
}) {
  const names = databaseNames(slug)
  const mainEnv = readFileSync(join(mainRepository, '.env'), 'utf8')
  const mainEnvTest = readFileSync(join(mainRepository, '.env.test'), 'utf8')
  const mainValues = readEnvValues(mainEnv)
  const mainTestValues = readEnvValues(mainEnvTest)
  const mainDatabaseUrl = mainValues.DATABASE_URL
  const mainTestDatabaseUrl = mainTestValues.DATABASE_URL ?? mainDatabaseUrl
  if (!mainDatabaseUrl || !mainTestDatabaseUrl) {
    throw new Error('DATABASE_URL is missing from the main checkout env files')
  }
  const developmentDatabaseUrl = withDatabaseName(
    mainDatabaseUrl,
    names.development
  )
  const testDatabaseUrl = withDatabaseName(mainTestDatabaseUrl, names.test)
  writeFileSync(
    join(worktreePath, '.env'),
    repointLocalhostUrls(
      upsertEnvValues(mainEnv, {
        DATABASE_URL: developmentDatabaseUrl,
        PORT: String(plan.port),
        HMR_PORT: String(plan.hmrPort),
        MAILDEV_PORT: String(plan.maildevPort),
        MAILDEV_WEB_PORT: String(plan.maildevWebPort),
        NEW_RELIC_ENABLED: 'false',
        DO_SPACES_BUCKET_NAME: bucketName(slug),
      }),
      Number(mainValues.PORT),
      plan.port
    )
  )
  writeFileSync(
    join(worktreePath, '.env.test'),
    repointLocalhostUrls(
      upsertEnvValues(mainEnvTest, {
        DATABASE_URL: testDatabaseUrl,
        PORT: String(plan.testPort),
        MAILDEV_PORT: String(plan.testMaildevPort),
        MAILDEV_WEB_PORT: String(plan.testMaildevWebPort),
      }),
      Number(mainTestValues.PORT),
      plan.testPort
    )
  )
  log('wrote .env and .env.test with per-worktree overrides')
  return { developmentDatabaseUrl, testDatabaseUrl }
}

function validateWorktreeEnvFiles(worktreePath: string) {
  const schemas = [appEnvironmentSchema, frameworkEnvironmentSchema]
  const failures = ['.env', '.env.test']
    .map((envFile) => {
      const values = readEnvValues(
        readFileSync(join(worktreePath, envFile), 'utf8')
      )
      return { envFile, keys: missingEnvKeys(values, schemas) }
    })
    .filter(({ keys }) => keys.length > 0)
  if (failures.length === 0) return
  const details = failures
    .map(({ envFile, keys }) => `  ${envFile}: ${keys.join(', ')}`)
    .join('\n')
  throw new Error(
    `worktree env files do not satisfy the app env schema:\n${details}\nadd these keys to the main checkout's .env and .env.test; setup copies them into every worktree`
  )
}

function existingEnvPlan(worktreePath: string) {
  const envPath = join(worktreePath, '.env')
  if (!existsSync(envPath)) return null
  const envContents = readFileSync(envPath, 'utf8')
  if (!envContents.includes(ENV_MARKER)) return null
  const values = readEnvValues(envContents)
  const testValues = readEnvValues(
    readFileSync(join(worktreePath, '.env.test'), 'utf8')
  )
  if (!values.DATABASE_URL || !testValues.DATABASE_URL) {
    throw new Error(
      `env files at ${worktreePath} carry the isolation marker but no DATABASE_URL; fix or delete them and re-run`
    )
  }
  log('env files already provisioned; keeping existing ports and databases')
  return {
    plan: {
      port: Number(values.PORT),
      hmrPort: Number(values.HMR_PORT),
      maildevPort: Number(values.MAILDEV_PORT),
      maildevWebPort: Number(values.MAILDEV_WEB_PORT),
      testPort: Number(testValues.PORT),
      testMaildevPort: Number(testValues.MAILDEV_PORT),
      testMaildevWebPort: Number(testValues.MAILDEV_WEB_PORT),
    },
    developmentDatabaseUrl: values.DATABASE_URL,
    testDatabaseUrl: testValues.DATABASE_URL,
  }
}

function summary({
  worktreePath,
  branchName,
  plan,
  developmentDatabaseUrl,
  testDatabaseUrl,
}: {
  worktreePath: string
  branchName: string
  plan: PortPlan
  developmentDatabaseUrl: string
  testDatabaseUrl: string
}) {
  return [
    `Worktree ready at ${worktreePath}`,
    `  branch:        ${branchName}`,
    `  dev server:    http://localhost:${plan.port} (HMR ${plan.hmrPort})`,
    `  dev maildev:   http://localhost:${plan.maildevWebPort} (SMTP ${plan.maildevPort})`,
    `  dev database:  ${databaseNameFromUrl(developmentDatabaseUrl)}`,
    `  test server:   http://localhost:${plan.testPort} (E2E workers hold ${plan.testPort}-${plan.testPort + E2E_WORKER_COUNT - 1})`,
    `  test maildev:  http://localhost:${plan.testMaildevWebPort} (SMTP ${plan.testMaildevPort})`,
    `  test database: ${databaseNameFromUrl(testDatabaseUrl)}`,
    `Next: cd ${worktreePath} && pnpm run dev`,
  ].join('\n')
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      hook: { type: 'boolean', default: false },
      branch: { type: 'string' },
      base: { type: 'string' },
      'skip-seed': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  const mainRepository = resolveMainRepository()

  let worktreePath: string
  let branchName: string
  let baseReference = values.base
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
      throw new Error(
        'WorktreeCreate hook input did not include a worktree path'
      )
    }
    worktreePath = resolve(inputPath)
    branchName = input.branch_name || `worktree/${basename(worktreePath)}`
    baseReference ??= input.base_branch
  } else {
    const lane = positionals[0]
    if (!lane) {
      throw new Error(
        'usage: pnpm run worktree:setup <lane> [--branch name] [--base ref] [--skip-seed]'
      )
    }
    worktreePath = resolve(
      dirname(mainRepository),
      WORKTREES_DIRECTORY_NAME,
      lane
    )
    branchName = values.branch || `worktree/${lane}`
  }
  baseReference ??= defaultBaseReference(mainRepository)
  const slug = laneSlug(basename(worktreePath))
  if (!slug) {
    throw new Error(`cannot derive a slug from "${basename(worktreePath)}"`)
  }

  ensureWorktree({ mainRepository, worktreePath, branchName, baseReference })

  const existing = existingEnvPlan(worktreePath)
  const plan =
    existing?.plan ??
    (await resolvePortPlan(
      slug,
      collectReservedPorts(mainRepository, worktreePath),
      isPortFree
    ))
  const { developmentDatabaseUrl, testDatabaseUrl } =
    existing ?? provisionEnvFiles({ mainRepository, worktreePath, slug, plan })

  validateWorktreeEnvFiles(worktreePath)

  const createdDevelopmentDatabase = await ensureDatabase(
    developmentDatabaseUrl
  )
  await ensureDatabase(testDatabaseUrl)

  runStep('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], {
    cwd: worktreePath,
  })
  runStep('pnpm', ['run', 'storage:bucket'], {
    cwd: worktreePath,
    env: { DO_SPACES_BUCKET_NAME: bucketName(slug) },
  })
  runStep('pnpm', ['run', 'db:migrate:production'], {
    cwd: worktreePath,
    env: { DATABASE_URL: developmentDatabaseUrl },
  })
  runStep('pnpm', ['run', 'db:migrate:production'], {
    cwd: worktreePath,
    env: { DATABASE_URL: testDatabaseUrl },
  })
  if (createdDevelopmentDatabase && !values['skip-seed']) {
    runStep('pnpm', ['run', 'db:seed:dev'], {
      cwd: worktreePath,
      env: { DATABASE_URL: developmentDatabaseUrl },
    })
  }

  const summaryText = summary({
    worktreePath,
    branchName,
    plan,
    developmentDatabaseUrl,
    testDatabaseUrl,
  })
  log(`\n${summaryText}`)
  console.log(values.hook ? worktreePath : summaryText)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
