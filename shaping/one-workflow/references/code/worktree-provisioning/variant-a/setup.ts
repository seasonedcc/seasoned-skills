import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type pg from 'pg'
import {
  APP_ENV_FILE,
  APP_TEST_ENV_FILE,
  databaseNameFromUrl,
  databaseNames,
  ENV_MARKER,
  laneSlug,
  type PortPlan,
  readEnvValues,
  reservedPortsFromEnvFiles,
  resolvePortPlan,
  type TemplateFingerprint,
  type TemplateKind,
  upsertEnvValues,
  WORKTREES_DIRECTORY_NAME,
  withDatabaseName,
  worktreePathFromHookInput,
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
import { provisionDatabaseFromTemplate, templateFingerprints } from './template'

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
  const envFileContents = worktreePathsFromPorcelain(
    listing,
    currentWorktreePath
  ).flatMap((worktreePath) =>
    [APP_ENV_FILE, APP_TEST_ENV_FILE].map((envFile) => {
      const envPath = join(worktreePath, envFile)
      return existsSync(envPath) ? readFileSync(envPath, 'utf8') : null
    })
  )
  return reservedPortsFromEnvFiles(envFileContents)
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

function installDependencies(worktreePath: string) {
  log('running: pnpm install --frozen-lockfile --prefer-offline')
  const child = spawn(
    'pnpm',
    ['install', '--frozen-lockfile', '--prefer-offline'],
    {
      cwd: worktreePath,
      stdio: ['ignore', 2, 2],
      env: { ...process.env, DOTENV_CONFIG_PATH: undefined },
    }
  )
  const installation = new Promise<void>((resolveInstall, rejectInstall) => {
    child.once('error', rejectInstall)
    child.once('exit', (code) =>
      code === 0
        ? resolveInstall()
        : rejectInstall(new Error(`pnpm install failed with exit code ${code}`))
    )
  })
  installation.catch(() => {})
  return installation
}

async function provisionDatabase({
  client,
  adminUrl,
  worktreePath,
  databaseUrl,
  kind,
  fingerprint,
  freshSeed,
  prepareWorktree,
}: {
  client: pg.Client
  adminUrl: string
  worktreePath: string
  databaseUrl: string
  kind: TemplateKind
  fingerprint: TemplateFingerprint
  freshSeed: boolean
  prepareWorktree: () => Promise<void>
}) {
  const databaseName = databaseNameFromUrl(databaseUrl)
  const existing = await client.query(
    'select 1 from pg_database where datname = $1',
    [databaseName]
  )
  if (existing.rowCount) {
    log(`database ${databaseName} already exists`)
    await prepareWorktree()
    runStep('pnpm', ['run', 'db:migrate:production'], {
      cwd: worktreePath,
      env: { DATABASE_URL: databaseUrl },
    })
    return
  }
  await provisionDatabaseFromTemplate({
    client,
    adminUrl,
    worktreePath,
    databaseName,
    kind,
    fingerprint,
    freshSeed,
    prepareWorktree,
  })
  log(`created database ${databaseName}`)
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
  const mainEnv = readFileSync(join(mainRepository, APP_ENV_FILE), 'utf8')
  const mainEnvTestPath = join(mainRepository, APP_TEST_ENV_FILE)
  const mainEnvTest = existsSync(mainEnvTestPath)
    ? readFileSync(mainEnvTestPath, 'utf8')
    : mainEnv
  const mainDatabaseUrl = readEnvValues(mainEnv).DATABASE_URL
  const mainTestDatabaseUrl =
    readEnvValues(mainEnvTest).DATABASE_URL ?? mainDatabaseUrl
  if (!mainDatabaseUrl || !mainTestDatabaseUrl) {
    throw new Error('DATABASE_URL is missing from the main checkout env files')
  }
  const developmentDatabaseUrl = withDatabaseName(
    mainDatabaseUrl,
    names.development
  )
  const testDatabaseUrl = withDatabaseName(mainTestDatabaseUrl, names.test)
  writeFileSync(
    join(worktreePath, APP_ENV_FILE),
    upsertEnvValues(mainEnv, {
      DATABASE_URL: developmentDatabaseUrl,
      PORT: String(plan.port),
      HMR_PORT: String(plan.hmrPort),
      MAILDEV_PORT: String(plan.maildevPort),
      MAILDEV_WEB_PORT: String(plan.maildevWebPort),
      NEW_RELIC_ENABLED: 'false',
    })
  )
  writeFileSync(
    join(worktreePath, APP_TEST_ENV_FILE),
    upsertEnvValues(mainEnvTest, {
      DATABASE_URL: testDatabaseUrl,
      PORT: String(plan.testPort),
      MAILDEV_PORT: String(plan.testMaildevPort),
      MAILDEV_WEB_PORT: String(plan.testMaildevWebPort),
    })
  )
  log('wrote .env and .env.test with per-worktree overrides')
  return { developmentDatabaseUrl, testDatabaseUrl }
}

function existingEnvPlan(worktreePath: string) {
  const envPath = join(worktreePath, APP_ENV_FILE)
  if (!existsSync(envPath)) return null
  const envContents = readFileSync(envPath, 'utf8')
  if (!envContents.includes(ENV_MARKER)) return null
  const values = readEnvValues(envContents)
  const testValues = readEnvValues(
    readFileSync(join(worktreePath, APP_TEST_ENV_FILE), 'utf8')
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
    `  test server:   http://localhost:${plan.testPort}`,
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
      'fresh-seed': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  const mainRepository = resolveMainRepository()

  let worktreePath: string
  let branchName: string
  let baseReference = values.base
  if (values.hook) {
    const input = await readStdinJson()
    const inputPath = worktreePathFromHookInput(
      input,
      join(dirname(mainRepository), WORKTREES_DIRECTORY_NAME)
    )
    if (!inputPath) {
      throw new Error(
        'WorktreeCreate hook input did not include a worktree path or name'
      )
    }
    worktreePath = resolve(inputPath)
    branchName = input.branch || `worktree/${basename(worktreePath)}`
    baseReference ??= input.base_branch
  } else {
    const lane = positionals[0]
    if (!lane) {
      throw new Error(
        'usage: pnpm run worktree:setup <lane> [--branch name] [--base ref] [--skip-seed] [--fresh-seed]'
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

  const installation = installDependencies(worktreePath)
  const prepareWorktree = () => installation
  const fingerprints = templateFingerprints(worktreePath)
  const developmentKind: TemplateKind = values['skip-seed']
    ? 'test'
    : 'development'

  await withAdminClient(developmentDatabaseUrl, async (client) => {
    await provisionDatabase({
      client,
      adminUrl: developmentDatabaseUrl,
      worktreePath,
      databaseUrl: developmentDatabaseUrl,
      kind: developmentKind,
      fingerprint: fingerprints[developmentKind],
      freshSeed: values['fresh-seed'],
      prepareWorktree,
    })
    await provisionDatabase({
      client,
      adminUrl: testDatabaseUrl,
      worktreePath,
      databaseUrl: testDatabaseUrl,
      kind: 'test',
      fingerprint: fingerprints.test,
      freshSeed: values['fresh-seed'],
      prepareWorktree,
    })
  })

  await installation

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
