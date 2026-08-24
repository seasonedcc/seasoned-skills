import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type pg from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ResolvedRepository,
  resolveProvisioning,
} from '../../src/provisioning/common.js'
import { provisionLane, teardownLane } from '../../src/provisioning/index.js'
import * as runtime from '../../src/provisioning/runtime.js'
import { provisionLaneDatabases } from '../../src/provisioning/setup.js'
import {
  readTemplateFingerprint,
  writeTemplateFingerprint,
} from '../../src/provisioning/template.js'

function initRepo(path: string) {
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: path })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: path })
  execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
    cwd: path,
  })
}

function cloneRepo(origin: string, path: string) {
  execFileSync('git', ['clone', '--quiet', origin, path])
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: path })
}

function commitEmpty(path: string, message: string) {
  execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', message], {
    cwd: path,
  })
}

function revisionOf(path: string, reference: string) {
  return execFileSync('git', ['rev-parse', reference], {
    cwd: path,
    encoding: 'utf8',
  }).trim()
}

function createOriginBranchAheadOfMain(origin: string, branch: string) {
  execFileSync('git', ['checkout', '--quiet', '-b', branch], { cwd: origin })
  commitEmpty(origin, `work on ${branch}`)
  execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: origin })
}

describe('lane setup and teardown without databases', () => {
  let root: string
  let repo: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-lane-')))
    repo = join(root, 'project')
    initRepo(repo)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('provisions worktrees only under skip-provision', async () => {
    const result = await provisionLane(repo, undefined, 'quick-fix', {
      skipProvision: true,
    })
    expect(result.slug).toBe('quick_fix')
    expect(existsSync(join(root, 'project-worktrees/quick-fix/.git'))).toBe(true)
    expect(result.repositories[0]?.seed).toContain('skipped')
    expect(result.summary).toContain('Lane quick-fix ready')
    // Idempotent: a re-run reuses the registered worktree.
    await provisionLane(repo, undefined, 'quick-fix', { skipProvision: true })
  })

  it('provisions a full lane, running steps with the allocation environment', async () => {
    const config = {
      repositories: [
        {
          path: '.',
          provisionSteps: ['echo "PORT=$APP" > step-ran.txt'],
          portBases: { app: 4600 },
        },
      ],
    }
    const result = await provisionLane(repo, config, 'feature-lane')
    const worktree = join(root, 'project-worktrees/feature-lane')
    expect(result.ports.app).toBeGreaterThanOrEqual(4600)
    const envFile = readFileSync(join(worktree, '.env'), 'utf8')
    expect(envFile).toContain('managed by seasoned-skills worktree provisioning')
    expect(envFile).toContain(`APP=${result.ports.app}`)
    expect(readFileSync(join(worktree, 'step-ran.txt'), 'utf8')).toBe(
      `PORT=${result.ports.app}\n`,
    )
    expect(result.repositories[0]?.seed).toBe('not applicable (no databases declared)')

    // The second run keeps the recorded allocation instead of reallocating.
    const again = await provisionLane(repo, config, 'feature-lane')
    expect(again.ports).toEqual(result.ports)
  })

  it('teardown refuses a dirty worktree unless forced, then removes it', async () => {
    await provisionLane(repo, undefined, 'dirty-lane', { skipProvision: true })
    const worktree = join(root, 'project-worktrees/dirty-lane')
    writeFileSync(join(worktree, 'uncommitted.txt'), 'work in progress')

    await expect(teardownLane(repo, undefined, 'dirty-lane')).rejects.toThrow(
      /uncommitted changes/,
    )
    expect(existsSync(worktree)).toBe(true)

    const result = await teardownLane(repo, undefined, 'dirty-lane', { force: true })
    expect(result.removedWorktrees).toEqual([worktree])
    expect(result.droppedDatabases).toEqual([])
    expect(existsSync(worktree)).toBe(false)
  })

  it('teardown of a clean lane removes the worktree and reports nothing else', async () => {
    await provisionLane(repo, undefined, 'clean-lane', { skipProvision: true })
    const result = await teardownLane(repo, undefined, 'clean-lane')
    expect(result).toEqual({
      lane: 'clean-lane',
      removedWorktrees: [join(root, 'project-worktrees/clean-lane')],
      droppedDatabases: [],
      killedProcessIds: [],
    })
  })

  it('teardown of an unprovisioned lane prunes quietly', async () => {
    const result = await teardownLane(repo, undefined, 'never-existed')
    expect(result.removedWorktrees).toEqual([])
  })

  it('provisions declared env files, each carrying its own slice of the allocation', async () => {
    writeFileSync(
      join(repo, '.env'),
      'SESSION_SECRET=s\nAPP_URL=http://localhost:4700/app\nAPP_PORT=4700\n',
    )
    const config = {
      repositories: [
        {
          path: '.',
          portBases: { app: 4700, testApp: 4800 },
          envFiles: [
            {
              path: '.env',
              ports: { APP_PORT: 'app' },
              extra: { TELEMETRY_ENABLED: 'false' },
            },
            {
              path: 'apps/web/.env.test',
              ports: { APP_PORT: 'testApp' },
              extra: { STORAGE_BUCKET: 'uploads-{slug-dashed}' },
            },
          ],
        },
      ],
    }
    const result = await provisionLane(repo, config, 'two-env-files')
    const worktree = join(root, 'project-worktrees/two-env-files')
    const appPort = result.ports.app as number
    const testAppPort = result.ports.testApp as number
    expect(testAppPort).not.toBe(appPort)

    // The dev file seeds from the main checkout's file, repoints its own
    // localhost URLs, and records the dev slice of the allocation.
    const devEnv = readFileSync(join(worktree, '.env'), 'utf8')
    expect(devEnv).toContain('managed by seasoned-skills worktree provisioning')
    expect(devEnv).toContain('SESSION_SECRET=s')
    expect(devEnv).toContain(`APP_URL=http://localhost:${appPort}/app`)
    expect(devEnv).toContain(`APP_PORT=${appPort}`)
    expect(devEnv).toContain('TELEMETRY_ENABLED=false')
    expect(devEnv).not.toContain('STORAGE_BUCKET')

    // The nested test file (no main counterpart) records the SAME key name
    // pointing at the test allocation, plus the slug-derived extra value.
    const testEnv = readFileSync(join(worktree, 'apps/web/.env.test'), 'utf8')
    expect(testEnv).toContain('managed by seasoned-skills worktree provisioning')
    expect(testEnv).toContain(`APP_PORT=${testAppPort}`)
    expect(testEnv).toContain('STORAGE_BUCKET=uploads-two-env-files')
    expect(testEnv).not.toContain('TELEMETRY_ENABLED')

    // Idempotent: the recorded allocation is parsed back from the files.
    const again = await provisionLane(repo, config, 'two-env-files')
    expect(again.ports).toEqual(result.ports)
    expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe(devEnv)

    const teardown = await teardownLane(repo, config, 'two-env-files', { force: true })
    expect(teardown.removedWorktrees).toEqual([worktree])
    expect(teardown.droppedDatabases).toEqual([])
    expect(existsSync(worktree)).toBe(false)
  })

  it('restores a deleted later env file from the allocation the marked files record', async () => {
    const config = {
      repositories: [
        {
          path: '.',
          portBases: { app: 4900 },
          envFiles: [
            { path: '.env', ports: { APP_PORT: 'app' } },
            { path: '.env.extra', extra: { LANE: '{slug}' } },
          ],
        },
      ],
    }
    const result = await provisionLane(repo, config, 'restore-lane')
    const worktree = join(root, 'project-worktrees/restore-lane')
    const extraPath = join(worktree, '.env.extra')
    const original = readFileSync(extraPath, 'utf8')
    expect(original).toContain('LANE=restore_lane')
    rmSync(extraPath)

    const again = await provisionLane(repo, config, 'restore-lane')
    expect(again.ports).toEqual(result.ports)
    expect(readFileSync(extraPath, 'utf8')).toBe(original)
  })
})

describe('the repositories a lane covers', () => {
  let root: string
  let project: string
  let engine: string

  const workspace = {
    repositories: [
      {
        path: '.',
        portBases: { app: 5600 },
        provisionSteps: ['echo "$APP" > app-port.txt'],
      },
      {
        path: '../engine',
        portBases: { engine: 5700 },
        provisionSteps: ['echo "$ENGINE" > engine-port.txt'],
      },
    ],
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-selection-')))
    project = join(root, 'project')
    engine = join(root, 'engine')
    initRepo(project)
    initRepo(engine)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('covers the first declared repository when none is asked for', async () => {
    const result = await provisionLane(project, workspace, 'default-selection')

    expect(result.repositories.map((one) => one.worktree.repository.path)).toEqual(['.'])
    expect(existsSync(join(root, 'project-worktrees/default-selection'))).toBe(true)
    expect(existsSync(join(root, 'engine-worktrees/default-selection'))).toBe(false)
    expect(result.ports).toEqual({ app: result.ports.app })
  })

  it('covers exactly the repository asked for, first or not', async () => {
    const result = await provisionLane(project, workspace, 'engine-only', {
      repositoryPaths: ['../engine'],
    })

    expect(result.repositories.map((one) => one.worktree.repository.path)).toEqual([
      '../engine',
    ])
    expect(existsSync(join(root, 'project-worktrees/engine-only'))).toBe(false)
    const worktree = join(root, 'engine-worktrees/engine-only')
    expect(readFileSync(join(worktree, 'engine-port.txt'), 'utf8')).toBe(
      `${result.ports.engine}\n`,
    )
    expect(result.ports.app).toBeUndefined()
  })

  it('anchors each covered repository to its own worktree, env file, and ports', async () => {
    const result = await provisionLane(project, workspace, 'both-repos', {
      repositoryPaths: ['.', '../engine'],
    })

    const projectWorktree = join(root, 'project-worktrees/both-repos')
    const engineWorktree = join(root, 'engine-worktrees/both-repos')
    const appPort = result.ports.app as number
    const enginePort = result.ports.engine as number
    expect(appPort).toBeGreaterThanOrEqual(5600)
    expect(enginePort).toBeGreaterThanOrEqual(5700)

    // Each repository's env file carries its own ports and only its own.
    const projectEnv = readFileSync(join(projectWorktree, '.env'), 'utf8')
    const engineEnv = readFileSync(join(engineWorktree, '.env'), 'utf8')
    expect(projectEnv).toContain(`APP=${appPort}`)
    expect(projectEnv).not.toContain('ENGINE=')
    expect(engineEnv).toContain(`ENGINE=${enginePort}`)
    expect(engineEnv).not.toContain('APP=')

    // Each repository's provision steps run in its own worktree, under its
    // own slice of the allocation.
    expect(readFileSync(join(projectWorktree, 'app-port.txt'), 'utf8')).toBe(
      `${appPort}\n`,
    )
    expect(readFileSync(join(engineWorktree, 'engine-port.txt'), 'utf8')).toBe(
      `${enginePort}\n`,
    )
    expect(existsSync(join(projectWorktree, 'engine-port.txt'))).toBe(false)
  })

  it('refuses a --repo value the table does not declare', async () => {
    await expect(
      provisionLane(project, workspace, 'typo', { repositoryPaths: ['../engin'] }),
    ).rejects.toThrow(
      /--repo \.\.\/engin matches no repository declared in seasoned-skills\.config\.ts; it declares "\.", "\.\.\/engine"/,
    )
    expect(existsSync(join(root, 'project-worktrees/typo'))).toBe(false)
    expect(existsSync(join(root, 'engine-worktrees/typo'))).toBe(false)
  })

  it('refuses a port name two covered repositories both declare', async () => {
    const colliding = {
      repositories: [
        { path: '.', portBases: { app: 5600 } },
        { path: '../engine', portBases: { app: 5700 } },
      ],
    }

    await expect(
      provisionLane(project, colliding, 'collision', {
        repositoryPaths: ['.', '../engine'],
      }),
    ).rejects.toThrow(/both declare the port "app"/)

    // Either repository alone is a perfectly good lane.
    const alone = await provisionLane(project, colliding, 'engine-alone', {
      repositoryPaths: ['../engine'],
    })
    expect(alone.ports.app).toBeGreaterThanOrEqual(5700)
  })

  it('pools the ports of every covered repository, equal bases and all', async () => {
    const sameBases = {
      repositories: [
        { path: '.', portBases: { app: 5800 } },
        { path: '../engine', portBases: { engine: 5800 } },
      ],
    }

    const result = await provisionLane(project, sameBases, 'pooled-lane', {
      repositoryPaths: ['.', '../engine'],
    })

    expect(result.ports.app).toBeGreaterThanOrEqual(5800)
    expect(result.ports.engine).not.toBe(result.ports.app)
  })

  it("seeds each covered repository's env file from its own main checkout", async () => {
    writeFileSync(join(project, '.env'), 'PROJECT_SECRET=project-only\n')
    writeFileSync(join(engine, '.env'), 'ENGINE_SECRET=engine-only\n')

    await provisionLane(project, workspace, 'own-env', {
      repositoryPaths: ['.', '../engine'],
    })

    const projectEnv = readFileSync(join(root, 'project-worktrees/own-env/.env'), 'utf8')
    const engineEnv = readFileSync(join(root, 'engine-worktrees/own-env/.env'), 'utf8')
    expect(projectEnv).toContain('PROJECT_SECRET=project-only')
    expect(projectEnv).not.toContain('ENGINE_SECRET')
    expect(engineEnv).toContain('ENGINE_SECRET=engine-only')
    expect(engineEnv).not.toContain('PROJECT_SECRET')
  })

  it('gives the lane one cache-store index, recorded by every repository asking for one', async () => {
    // Nothing listens on this port: the flush degrades to a warning.
    const cacheStoreUrl = 'redis://localhost:6399'
    writeFileSync(join(project, '.env'), `REDIS_URL=${cacheStoreUrl}\n`)
    writeFileSync(join(engine, '.env'), `REDIS_URL=${cacheStoreUrl}\n`)
    const cached = {
      repositories: [
        { path: '.', cacheStoreIndex: true },
        { path: '../engine', cacheStoreIndex: true },
      ],
    }

    const result = await provisionLane(project, cached, 'cache-lane', {
      repositoryPaths: ['.', '../engine'],
    })

    const laneUrl = result.repositories[0]?.cacheStoreUrl
    expect(laneUrl).toMatch(/^redis:\/\/localhost:6399\/([1-9]|1[0-4])$/)
    expect(result.repositories[1]?.cacheStoreUrl).toBe(laneUrl)
    expect(
      readFileSync(join(root, 'project-worktrees/cache-lane/.env'), 'utf8'),
    ).toContain(`REDIS_URL=${laneUrl}`)
    expect(
      readFileSync(join(root, 'engine-worktrees/cache-lane/.env'), 'utf8'),
    ).toContain(`REDIS_URL=${laneUrl}`)
  })

  it("starts shared services from the main checkout, on the whole table's env", async () => {
    // The URL lives in a repository this run does not cover, and the start
    // command reports the directory it ran from.
    writeFileSync(join(project, '.env'), 'CACHE_URL=redis://localhost:6399\n')
    const shared = {
      ...workspace,
      services: ['cache'],
      serviceStartCommand: 'pwd > started-from.txt; echo starting',
    }

    await provisionLane(project, shared, 'service-lane', {
      repositoryPaths: ['../engine'],
    })

    expect(readFileSync(join(project, 'started-from.txt'), 'utf8')).toBe(`${project}\n`)
    expect(existsSync(join(engine, 'started-from.txt'))).toBe(false)
  })

  it('flushes a fresh cache-store index once, before any repository runs a step', async () => {
    writeFileSync(join(project, '.env'), 'REDIS_URL=redis://localhost:6399\n')
    writeFileSync(join(engine, '.env'), 'REDIS_URL=redis://localhost:6399\n')
    const cached = {
      repositories: [
        { path: '.', cacheStoreIndex: true, provisionSteps: ['touch step-ran.txt'] },
        { path: '../engine', cacheStoreIndex: true },
      ],
    }
    const stepMarker = join(root, 'project-worktrees/flush-lane/step-ran.txt')
    const flushed: { url: string; afterAStep: boolean }[] = []
    vi.spyOn(runtime, 'flushCacheStore').mockImplementation((url) => {
      flushed.push({ url, afterAStep: existsSync(stepMarker) })
    })

    const result = await provisionLane(project, cached, 'flush-lane', {
      repositoryPaths: ['.', '../engine'],
    })

    expect(flushed).toEqual([
      { url: result.repositories[0]?.cacheStoreUrl, afterAStep: false },
    ])
    expect(existsSync(stepMarker)).toBe(true)
  })

  it('steers a later run around the ports the lane already holds elsewhere', async () => {
    const sameBases = {
      repositories: [
        { path: '.', portBases: { app: 5900 } },
        { path: '../engine', portBases: { engine: 5900 } },
      ],
    }
    const first = await provisionLane(project, sameBases, 'two-run-lane')

    const second = await provisionLane(project, sameBases, 'two-run-lane', {
      repositoryPaths: ['../engine'],
    })

    expect(second.ports.engine).not.toBe(first.ports.app)
    expect(
      readFileSync(join(root, 'project-worktrees/two-run-lane/.env'), 'utf8'),
    ).toContain(`APP=${first.ports.app}`)
  })

  it('keeps clear of a sibling lane serving a port in an uncovered repository', async () => {
    const sameBases = {
      repositories: [
        { path: '.', portBases: { app: 6200 } },
        { path: '../engine', portBases: { engine: 6200 } },
      ],
    }
    const target = await provisionLane(project, sameBases, 'target-lane')
    const claimed = target.ports.app as number
    await teardownLane(project, sameBases, 'target-lane', { force: true })
    // A sibling lane serving the very port this lane's hash points at, in the
    // repository the next run does not cover.
    await provisionLane(project, sameBases, 'neighbour-lane', {
      repositoryPaths: ['../engine'],
    })
    const neighbourEnv = join(root, 'engine-worktrees/neighbour-lane/.env')
    writeFileSync(
      neighbourEnv,
      readFileSync(neighbourEnv, 'utf8').replace(/ENGINE=.*/, `ENGINE=${claimed}`),
    )

    const again = await provisionLane(project, sameBases, 'target-lane')

    expect(again.ports.app).not.toBe(claimed)
  })

  it('keeps clear of a sibling lane holding a cache-store index in an uncovered repository', async () => {
    writeFileSync(join(project, '.env'), 'REDIS_URL=redis://localhost:6399\n')
    writeFileSync(join(engine, '.env'), 'REDIS_URL=redis://localhost:6399\n')
    const cached = {
      repositories: [
        { path: '.', cacheStoreIndex: true },
        { path: '../engine', cacheStoreIndex: true },
      ],
    }
    const target = await provisionLane(project, cached, 'index-lane')
    const claimed = target.repositories[0]?.cacheStoreUrl as string
    await teardownLane(project, cached, 'index-lane', { force: true })
    await provisionLane(project, cached, 'neighbour-lane', {
      repositoryPaths: ['../engine'],
    })
    const neighbourEnv = join(root, 'engine-worktrees/neighbour-lane/.env')
    writeFileSync(
      neighbourEnv,
      readFileSync(neighbourEnv, 'utf8').replace(/REDIS_URL=.*/, `REDIS_URL=${claimed}`),
    )

    const again = await provisionLane(project, cached, 'index-lane')

    expect(again.repositories[0]?.cacheStoreUrl).not.toBe(claimed)
  })

  it('keeps the ports a live lane holds when a repository joins it later', async () => {
    const first = await provisionLane(project, workspace, 'grown-lane')
    // A port the lane holds is the lane's, whatever the hash would pick now.
    const projectEnvPath = join(root, 'project-worktrees/grown-lane/.env')
    const held = (first.ports.app as number) + 37
    writeFileSync(
      projectEnvPath,
      readFileSync(projectEnvPath, 'utf8').replace(
        `APP=${first.ports.app}`,
        `APP=${held}`,
      ),
    )

    const grown = await provisionLane(project, workspace, 'grown-lane', {
      repositoryPaths: ['.', '../engine'],
    })

    expect(grown.ports.app).toBe(held)
    expect(readFileSync(projectEnvPath, 'utf8')).toContain(`APP=${held}`)
    expect(grown.ports.engine).toBeGreaterThanOrEqual(5700)
    expect(
      readFileSync(join(root, 'engine-worktrees/grown-lane/.env'), 'utf8'),
    ).toContain(`ENGINE=${grown.ports.engine}`)
  })

  it('tears a lane down across the whole table, whatever subset it covered', async () => {
    await provisionLane(project, workspace, 'subset-lane')
    expect(existsSync(join(root, 'engine-worktrees/subset-lane'))).toBe(false)

    const result = await teardownLane(project, workspace, 'subset-lane', {
      force: true,
    })

    expect(result.removedWorktrees).toEqual([join(root, 'project-worktrees/subset-lane')])
    expect(existsSync(join(root, 'project-worktrees/subset-lane'))).toBe(false)
  })

  it('tears a lane down past a declared repository it never reached', async () => {
    // Port 1 refuses instantly: reaching for this server at all would abort
    // the teardown of a lane that never touched the repository declaring it.
    writeFileSync(
      join(engine, '.env'),
      'ENGINE_DATABASE_URL=postgres://user:pass@localhost:1/engine\n',
    )
    const withDatabases = {
      repositories: [
        { path: '.', portBases: { app: 6000 } },
        {
          path: '../engine',
          migrateCommand: 'true',
          databases: [{ name: 'engine' }],
        },
      ],
    }
    await provisionLane(project, withDatabases, 'lonely-lane')

    const result = await teardownLane(project, withDatabases, 'lonely-lane', {
      force: true,
    })

    expect(result.removedWorktrees).toEqual([join(root, 'project-worktrees/lonely-lane')])
    expect(result.droppedDatabases).toEqual([])
    expect(existsSync(join(root, 'project-worktrees/lonely-lane'))).toBe(false)
  })

  it('tears down every worktree a lane spread across', async () => {
    await provisionLane(project, workspace, 'wide-lane', {
      repositoryPaths: ['.', '../engine'],
    })

    const result = await teardownLane(project, workspace, 'wide-lane', { force: true })

    expect(result.removedWorktrees).toEqual([
      join(root, 'project-worktrees/wide-lane'),
      join(root, 'engine-worktrees/wide-lane'),
    ])
  })
})

describe('lane worktrees against an origin remote', () => {
  let root: string
  let origin: string
  let clone: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-origin-')))
    origin = join(root, 'origin')
    initRepo(origin)
    clone = join(root, 'clone')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('adopts an origin-only lane branch without setting an upstream', async () => {
    createOriginBranchAheadOfMain(origin, 'worktree/pr-takeover')
    cloneRepo(origin, clone)

    await provisionLane(clone, undefined, 'pr-takeover', { skipProvision: true })

    const worktree = join(root, 'clone-worktrees/pr-takeover')
    expect(revisionOf(worktree, 'HEAD')).toBe(revisionOf(origin, 'worktree/pr-takeover'))
    expect(() =>
      execFileSync('git', ['config', '--get', 'branch.worktree/pr-takeover.merge'], {
        cwd: clone,
      }),
    ).toThrow()
  })

  it('creates a fresh lane branch without setting an upstream', async () => {
    cloneRepo(origin, clone)

    await provisionLane(clone, undefined, 'fresh-lane', { skipProvision: true })

    const worktree = join(root, 'clone-worktrees/fresh-lane')
    expect(revisionOf(worktree, 'HEAD')).toBe(revisionOf(origin, 'main'))
    expect(() =>
      execFileSync('git', ['config', '--get', 'branch.worktree/fresh-lane.merge'], {
        cwd: clone,
      }),
    ).toThrow()
  })

  it('fast-forwards a stale local lane branch to the origin tip', async () => {
    createOriginBranchAheadOfMain(origin, 'worktree/stale-lane')
    cloneRepo(origin, clone)
    execFileSync('git', ['branch', 'worktree/stale-lane', 'main'], { cwd: clone })

    await provisionLane(clone, undefined, 'stale-lane', { skipProvision: true })

    const worktree = join(root, 'clone-worktrees/stale-lane')
    expect(revisionOf(worktree, 'HEAD')).toBe(revisionOf(origin, 'worktree/stale-lane'))
  })

  it('keeps a diverged local lane branch as it is', async () => {
    createOriginBranchAheadOfMain(origin, 'worktree/diverged-lane')
    cloneRepo(origin, clone)
    execFileSync('git', ['checkout', '--quiet', '-b', 'worktree/diverged-lane'], {
      cwd: clone,
    })
    commitEmpty(clone, 'local divergence')
    const localTip = revisionOf(clone, 'worktree/diverged-lane')
    execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: clone })

    await provisionLane(clone, undefined, 'diverged-lane', { skipProvision: true })

    const worktree = join(root, 'clone-worktrees/diverged-lane')
    expect(revisionOf(worktree, 'HEAD')).toBe(localTip)
  })
})

describe('lane database provisioning', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-databases-')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('creates every declared database before running any migration', async () => {
    const migrateCommand =
      'test -f project_wt_lane_main.created && test -f project_wt_lane_message.created && echo migrated >> migrations.txt'
    const resolved = resolveProvisioning(
      {
        repositories: [
          {
            path: '.',
            migrateCommand,
            databases: [{ name: 'main' }, { name: 'message' }],
          },
        ],
      },
      { databasePrefix: 'project_wt_' },
    )
    const repository = resolved.repositories[0] as ResolvedRepository
    const createdDatabases = new Set<string>()
    const client = {
      query: vi.fn(async (sql: string, values?: string[]) => {
        if (sql.startsWith('select 1 from pg_database')) {
          return { rowCount: createdDatabases.has(values?.[0] ?? '') ? 1 : 0 }
        }
        const databaseName = sql.slice('create database "'.length, -1)
        createdDatabases.add(databaseName)
        writeFileSync(join(root, `${databaseName}.created`), '')
        return { rowCount: 0 }
      }),
    } as unknown as pg.Client
    const mainUrl = 'postgres://user@localhost:5432/project_wt_lane_main'
    const messageUrl = 'postgres://user@localhost:5432/project_wt_lane_message'

    const databases = await provisionLaneDatabases({
      client,
      resolved,
      repository,
      allocation: { ports: {}, databaseUrls: { main: mainUrl, message: messageUrl } },
      slug: 'lane',
      worktreePath: root,
      migrateCommand,
      seedCommand: undefined,
      stepEnv: {},
      options: {},
    })

    expect(readFileSync(join(root, 'migrations.txt'), 'utf8')).toBe(
      'migrated\nmigrated\n',
    )
    expect(databases).toEqual([
      {
        name: 'main',
        databaseName: 'project_wt_lane_main',
        url: mainUrl,
        created: true,
      },
      {
        name: 'message',
        databaseName: 'project_wt_lane_message',
        url: messageUrl,
        created: true,
      },
    ])
  })
})

describe('template fingerprints on the database comment', () => {
  it('round-trips through comment-on-database, escaping quotes', async () => {
    let comment: string | null = null
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('comment on database')) {
          comment = sql
            .slice(sql.indexOf("'") + 1, sql.lastIndexOf("'"))
            .replaceAll("''", "'")
          return { rows: [] }
        }
        return { rows: [{ fingerprint: comment }] }
      }),
    } as unknown as pg.Client

    await writeTemplateFingerprint(client, 'prefix_template__main', {
      migrationsHash: 'abc',
      seedHash: 'def',
      seedDate: '2026-08-23',
    })
    expect(await readTemplateFingerprint(client, 'prefix_template__main')).toEqual({
      migrationsHash: 'abc',
      seedHash: 'def',
      seedDate: '2026-08-23',
    })
  })
})
