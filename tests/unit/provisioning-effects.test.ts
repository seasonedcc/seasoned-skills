import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveProvisioning } from '../../src/provisioning/common.js'
import {
  commandLine,
  git,
  gitSucceeds,
  isPortFree,
  isPortListening,
  ownProcessIds,
  portListenerProcessIds,
  processWorkingDirectory,
  resolveMainRepository,
  runStep,
} from '../../src/provisioning/runtime.js'
import {
  defaultBaseReference,
  ensureWorktree,
  laneWorktrees,
  worktreesRoot,
} from '../../src/provisioning/setup.js'
import { killLanePortListeners } from '../../src/provisioning/teardown.js'
import { collectSources } from '../../src/provisioning/template.js'

function initRepo(path: string) {
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: path })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: path })
  execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
    cwd: path,
  })
}

/** Starts a listener and resolves with its port once it is actually bound. */
function listen(server: Server): Promise<number> {
  return new Promise((resolvePort) => {
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address()
      resolvePort(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

/** Spawns a node child that listens on a port, resolving when it is bound. */
function spawnListener(cwd: string): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const s = require('node:net').createServer();
       s.listen(0, '127.0.0.1', () => console.log(s.address().port));
       setTimeout(() => {}, 60000);`,
    ],
    { cwd, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  return new Promise((resolveChild, rejectChild) => {
    child.once('error', rejectChild)
    child.stdout?.once('data', (data: Buffer) =>
      resolveChild({ child, port: Number(data.toString().trim()) }),
    )
  })
}

describe('provisioning runtime helpers', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-prov-')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('git returns trimmed output and throws on failure', () => {
    const repo = join(root, 'repo')
    initRepo(repo)
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo })).toBe('main')
    expect(() => git(['not-a-command'], { cwd: repo })).toThrow(/git not-a-command/)
    expect(gitSucceeds(['status'], { cwd: repo })).toBe(true)
    expect(gitSucceeds(['not-a-command'], { cwd: repo })).toBe(false)
  })

  it('resolves the main repository from inside one of its worktrees', () => {
    const repo = join(root, 'repo')
    initRepo(repo)
    const worktree = join(root, 'repo-worktrees', 'lane')
    mkdirSync(join(root, 'repo-worktrees'), { recursive: true })
    execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'lane', worktree], {
      cwd: repo,
    })
    expect(resolveMainRepository(repo)).toBe(repo)
    expect(resolveMainRepository(worktree)).toBe(repo)
  })

  it('probes port freedom and listening through real sockets', async () => {
    const server = createServer()
    const port = await listen(server)
    expect(await isPortFree(port)).toBe(false)
    expect(await isPortListening(port)).toBe(true)
    await new Promise((resolveClose) => server.close(resolveClose))
    expect(await isPortFree(port)).toBe(true)
    expect(await isPortListening(port)).toBe(false)
  })

  it('runs a configured step with the lane environment and fails loud', () => {
    runStep('echo "$LANE_MARKER" > marker.txt', {
      cwd: root,
      env: { LANE_MARKER: 'lane-42' },
    })
    expect(execFileSync('cat', ['marker.txt'], { cwd: root, encoding: 'utf8' })).toBe(
      'lane-42\n',
    )
    expect(() => runStep('exit 3', { cwd: root })).toThrow(/exit code 3/)
  })

  it('reads its own process identity through ps and lsof', () => {
    expect(ownProcessIds().has(process.pid)).toBe(true)
    expect(commandLine(process.pid)).toContain('node')
    expect(processWorkingDirectory(process.pid)).toBe(process.cwd())
  })

  it('finds the pid listening on a port', async () => {
    const server = createServer()
    const port = await listen(server)
    expect(portListenerProcessIds(port)).toContain(process.pid)
    await new Promise((resolveClose) => server.close(resolveClose))
    expect(portListenerProcessIds(port)).toEqual([])
  })
})

describe('lane worktrees', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-lanes-')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('maps every declared repository to its lane worktree path', () => {
    const repo = join(root, 'project')
    const resolved = resolveProvisioning(
      { repositories: [{ path: '.' }, { path: '../sibling' }] },
      { databasePrefix: 'project_wt_' },
    )
    const worktrees = laneWorktrees(
      repo,
      resolved.repositories,
      'lane-a',
      'worktree/lane-a',
    )
    expect(worktrees.map((worktree) => worktree.worktreePath)).toEqual([
      join(root, 'project-worktrees', 'lane-a'),
      join(root, 'sibling-worktrees', 'lane-a'),
    ])
    expect(worktreesRoot(repo)).toBe(join(root, 'project-worktrees'))
  })

  it('creates a worktree on a new branch, reuses it, and refuses a squatter', () => {
    const repo = join(root, 'repo')
    initRepo(repo)
    const worktreePath = join(root, 'repo-worktrees', 'lane')
    const create = () =>
      ensureWorktree({
        repositoryPath: repo,
        worktreePath,
        branchName: 'worktree/lane',
        baseReference: 'main',
      })
    create()
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath })).toBe(
      'worktree/lane',
    )
    create() // registered → reused, not an error
    const squatted = join(root, 'repo-worktrees', 'squatted')
    mkdirSync(squatted, { recursive: true })
    expect(() =>
      ensureWorktree({
        repositoryPath: repo,
        worktreePath: squatted,
        branchName: 'worktree/squatted',
        baseReference: 'main',
      }),
    ).toThrow(/not a registered worktree/)
  })

  it('checks out an existing branch instead of recreating it', () => {
    const repo = join(root, 'repo')
    initRepo(repo)
    execFileSync('git', ['branch', 'worktree/lane'], { cwd: repo })
    execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'ahead'], {
      cwd: repo,
    })
    const worktreePath = join(root, 'repo-worktrees', 'lane')
    ensureWorktree({
      repositoryPath: repo,
      worktreePath,
      branchName: 'worktree/lane',
      baseReference: 'main',
    })
    // The worktree sits on the branch as it was, not on main's newer commit.
    expect(git(['rev-parse', 'HEAD'], { cwd: worktreePath })).toBe(
      git(['rev-parse', 'worktree/lane'], { cwd: repo }),
    )
  })

  it('falls back to main when origin cannot be resolved', () => {
    const repo = join(root, 'repo')
    initRepo(repo)
    expect(defaultBaseReference(repo)).toBe('main')
  })
})

describe('killLanePortListeners', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-kills-')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  // A node child can take seconds to reach its first output while the rest of
  // the suite churns through processes, so the two start side by side.
  it('kills only listeners running from inside the lane worktrees', {
    timeout: 30_000,
  }, async () => {
    const lane = join(root, 'repo-worktrees', 'lane')
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(lane, { recursive: true })
    mkdirSync(elsewhere, { recursive: true })
    const [inside, stranger] = await Promise.all([
      spawnListener(lane),
      spawnListener(elsewhere),
    ])
    try {
      const killed = killLanePortListeners([inside.port, stranger.port], [lane])
      expect(killed).toEqual([inside.child.pid])
      expect(stranger.child.killed).toBe(false)
    } finally {
      inside.child.kill('SIGKILL')
      stranger.child.kill('SIGKILL')
    }
  })
})

describe('collectSources', () => {
  it('walks source paths deterministically, skipping test files', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-sources-')))
    try {
      mkdirSync(join(root, 'migrations/nested'), { recursive: true })
      writeFileSync(join(root, 'migrations/002-b.sql'), 'b')
      writeFileSync(join(root, 'migrations/001-a.sql'), 'a')
      writeFileSync(join(root, 'migrations/nested/003-c.sql'), 'c')
      writeFileSync(join(root, 'migrations/skipped.test.ts'), 'x')
      writeFileSync(join(root, 'seed.ts'), 'seed')
      const sources = collectSources(root, ['migrations', 'seed.ts', 'absent'])
      expect(sources).toEqual([
        ['migrations/001-a.sql', 'a'],
        ['migrations/002-b.sql', 'b'],
        ['migrations/nested/003-c.sql', 'c'],
        ['seed.ts', 'seed'],
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
