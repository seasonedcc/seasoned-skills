import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveProvisioning } from '../../src/provisioning/common.js'
import {
  listLaneProcesses,
  sweepLaneProcesses,
} from '../../src/provisioning/processes.js'
import {
  commandLine,
  git,
  gitSucceeds,
  isPortFree,
  isPortListening,
  portListenerProcessIds,
  portListenerProcessIdsFromProc,
  processWorkingDirectoriesFromLsof,
  processWorkingDirectoriesFromProc,
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
import {
  endedProcessId,
  exits,
  isRunning,
  LISTEN,
  RENAMED_LISTENER,
  spawnDummy,
  spawnOrphan,
  spawnOrphanMarkedByLaterProcess,
  spawnParentWithRenamedChild,
  spawnSessionWithChild,
  stopDummies,
} from './dummy-processes.js'
import { fakeCommands } from './fake-commands.js'

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

  it('reads its own command line and working directory', () => {
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

describe('finding processes from /proc', () => {
  let proc: string

  beforeEach(() => {
    proc = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-proc-')))
  })

  afterEach(() => {
    rmSync(proc, { recursive: true, force: true })
  })

  function fakeProcess(processId: number, links: Record<string, string>) {
    for (const [path, target] of Object.entries(links)) {
      mkdirSync(join(proc, String(processId), dirname(path)), { recursive: true })
      symlinkSync(target, join(proc, String(processId), path))
    }
  }

  it("reads every one of the user's processes with its working directory, whatever its name", () => {
    fakeProcess(123, { cwd: '/lanes/lane-a/apps/web' })
    fakeProcess(456, { cwd: '/home/dev' })
    mkdirSync(join(proc, '789'))
    mkdirSync(join(proc, 'net'))
    symlinkSync('123', join(proc, 'self'))

    const userId = userInfo().uid
    expect(
      processWorkingDirectoriesFromProc(proc, userId).sort(
        (first, second) => first.processId - second.processId,
      ),
    ).toEqual([
      { processId: 123, workingDirectory: '/lanes/lane-a/apps/web' },
      { processId: 456, workingDirectory: '/home/dev' },
    ])
    expect(processWorkingDirectoriesFromProc(proc, userId + 1)).toEqual([])
    expect(() =>
      processWorkingDirectoriesFromProc(join(proc, 'missing'), userId),
    ).toThrow()
  })

  it("refuses to read a listing missing one of the user's processes it could not read", () => {
    fakeProcess(123, { cwd: '/lanes/lane-a/apps/web' })
    mkdirSync(join(proc, '456'))
    writeFileSync(join(proc, '456', 'cwd'), '')

    const userId = userInfo().uid
    expect(() => processWorkingDirectoriesFromProc(proc, userId)).toThrow(
      /working directory of process 456/,
    )
    expect(processWorkingDirectoriesFromProc(proc, userId + 1)).toEqual([])
  })

  it('finds the processes holding a listening socket on a port, over IPv4 and IPv6', () => {
    const header =
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode'
    mkdirSync(join(proc, 'net'))
    writeFileSync(
      join(proc, 'net', 'tcp'),
      [
        header,
        '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 6392 1 0000000000000000 100 0 0 10 0',
        '   1: 0100007F:1F90 0100007F:D8EC 01 00000000:00000000 00:00000000 00000000   501        0 777 1 0000000000000000 20 4 30 10 -1',
        '   2: 0100007F:2382 00000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 999 1 0000000000000000 100 0 0 10 0',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(proc, 'net', 'tcp6'),
      [
        header,
        '   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 888 1 0000000000000000 100 0 0 10 0',
        '',
      ].join('\n'),
    )
    fakeProcess(10, { 'fd/3': 'socket:[6392]', 'fd/0': '/dev/null' })
    fakeProcess(11, { 'fd/4': 'socket:[777]' })
    fakeProcess(12, { 'fd/5': 'socket:[888]' })
    fakeProcess(13, { 'fd/6': 'socket:[999]' })
    mkdirSync(join(proc, '14'))

    const userId = userInfo().uid
    expect(portListenerProcessIdsFromProc(proc, 8080, userId).sort()).toEqual([10, 12])
    expect(portListenerProcessIdsFromProc(proc, 9090, userId)).toEqual([13])
    expect(portListenerProcessIdsFromProc(proc, 4000, userId)).toEqual([])
    expect(portListenerProcessIdsFromProc(proc, 8080, userId + 1)).toEqual([])
  })

  it('finds a listener even when some of its descriptors close before they are read', () => {
    mkdirSync(join(proc, 'net'))
    writeFileSync(
      join(proc, 'net', 'tcp'),
      [
        '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
        '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 6392 1 0000000000000000 100 0 0 10 0',
        '',
      ].join('\n'),
    )
    fakeProcess(10, { 'fd/5': 'socket:[6392]' })
    for (const closed of ['0', '1', '2', '3', '4', '6', '7']) {
      writeFileSync(join(proc, '10', 'fd', closed), '')
    }

    expect(portListenerProcessIdsFromProc(proc, 8080, userInfo().uid)).toEqual([10])
  })
})

describe('finding processes through lsof', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-lsof-')))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it("reads every one of the user's processes with its working directory", () => {
    fakeCommands(root, { lsof: "printf 'p123\\nfcwd\\nn/lanes/lane-a\\n'" })
    expect(processWorkingDirectoriesFromLsof()).toEqual([
      { processId: 123, workingDirectory: '/lanes/lane-a' },
    ])
  })

  it('reads a warning-only run with nothing matched as no processes', () => {
    fakeCommands(root, {
      lsof: [
        'case " $* " in',
        '  *" -w "*) exit 1 ;;',
        '  *) echo "lsof: WARNING: can\'t stat() fuse file system /run/user/501/doc" >&2; exit 1 ;;',
        'esac',
      ].join('\n'),
    })
    expect(processWorkingDirectoriesFromLsof()).toEqual([])
  })

  it('throws when lsof could not list the processes', () => {
    const realPath = process.env.PATH
    for (const [failure, reason] of [
      ["echo 'lsof: unknown option' >&2; exit 1", 'lsof: unknown option'],
      ['kill -9 $$', 'killed by SIGKILL'],
      ['exit 2', 'exit status 2'],
    ]) {
      vi.stubEnv('PATH', realPath)
      fakeCommands(root, { lsof: failure ?? '' })
      expect(() => processWorkingDirectoriesFromLsof()).toThrow(
        `lsof could not list the processes' working directories: ${reason}`,
      )
    }
    vi.stubEnv('PATH', realPath)
    fakeCommands(root, {}, { only: true })
    expect(() => processWorkingDirectoriesFromLsof()).toThrow('ENOENT')
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
    stopDummies()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('kills only its own listeners running from inside the lane worktrees', {
    timeout: 30_000,
  }, async () => {
    const lane = join(root, 'repo-worktrees', 'lane')
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(lane, { recursive: true })
    mkdirSync(elsewhere, { recursive: true })
    vi.stubEnv('CLAUDE_PID', String(process.pid))
    const mine = { claudeProcessId: process.pid }
    const [inside, stranger, unmarked, live] = await Promise.all([
      spawnDummy(lane, { marker: mine, script: RENAMED_LISTENER }),
      spawnDummy(elsewhere, { marker: mine, script: LISTEN }),
      spawnOrphan(lane, { script: LISTEN }),
      spawnSessionWithChild(lane, 'other-session', { script: LISTEN }),
    ])

    const killed = killLanePortListeners(
      [inside, stranger, unmarked, live.child].map((listener) => Number(listener.line)),
      [lane],
    )

    expect(killed).toEqual([inside.pid])
    expect(await exits(inside)).toBe(true)
    expect([stranger, unmarked, live.child].every(isRunning)).toBe(true)
  })
})

describe('lane-process sweep ownership', () => {
  let root: string
  let repo: string
  let lane: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-sweep-')))
    repo = join(root, 'project')
    initRepo(repo)
    lane = join(root, 'project-worktrees', 'lane-a')
    mkdirSync(lane, { recursive: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    stopDummies()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  async function laneOfEveryOwnership() {
    vi.stubEnv('CLAUDE_PID', String(process.pid))
    const endedSession = await endedProcessId()
    const [mine, ended, live, unmarked] = await Promise.all([
      spawnDummy(lane, { marker: { claudeProcessId: process.pid } }),
      spawnOrphan(lane, { marker: { claudeProcessId: endedSession } }),
      spawnSessionWithChild(lane, 'other-session'),
      spawnOrphan(lane),
    ])
    const { dummy: recycled } = await spawnOrphanMarkedByLaterProcess(lane, root)
    return {
      mine,
      ended,
      recycled,
      live: live.child,
      unmarked,
      otherSession: live.session,
      endedSession,
    }
  }

  it('classifies every process in a lane by the Claude Code instance that started it', {
    timeout: 30_000,
  }, async () => {
    const lane = await laneOfEveryOwnership()

    const listed = listLaneProcesses(repo, undefined)

    expect(
      Object.fromEntries(listed.map((entry) => [entry.processId, entry.ownership])),
    ).toEqual({
      [lane.mine.pid]: { kind: 'mine' },
      [lane.ended.pid]: { kind: 'ended-session', claudeProcessId: lane.endedSession },
      [lane.recycled.pid]: expect.objectContaining({ kind: 'ended-session' }),
      [lane.live.pid]: {
        kind: 'live-session',
        claudeProcessId: lane.otherSession.pid,
        sessionId: 'other-session',
      },
      [lane.unmarked.pid]: { kind: 'unmarked' },
    })
    expect(listed.every((entry) => entry.lane === 'lane-a')).toBe(true)
    expect(
      [lane.mine, lane.ended, lane.recycled, lane.live, lane.unmarked].every(isRunning),
    ).toBe(true)
  })

  it('trusts its own marker only when it names a Claude Code instance it runs under', {
    timeout: 30_000,
  }, async () => {
    const impostor = await spawnDummy(root)
    vi.stubEnv('CLAUDE_PID', String(impostor.pid))
    const marked = await spawnOrphan(lane, { marker: { claudeProcessId: impostor.pid } })

    const listed = listLaneProcesses(repo, undefined)

    expect(listed.find((entry) => entry.processId === marked.pid)?.ownership).toEqual({
      kind: 'live-session',
      claudeProcessId: impostor.pid,
    })
  })

  it('finds the owner of a renamed, unmarked process through its ancestry alone', {
    timeout: 30_000,
  }, async () => {
    vi.stubEnv('CLAUDE_PID', String(process.pid))
    const [{ child: renamed }, unmarked, live] = await Promise.all([
      spawnParentWithRenamedChild(lane),
      spawnOrphan(lane),
      spawnSessionWithChild(lane, 'other-session'),
    ])

    const listed = listLaneProcesses(repo, undefined)
    expect(listed.find((entry) => entry.processId === renamed.pid)?.ownership).toEqual({
      kind: 'mine',
    })

    sweepLaneProcesses(repo, undefined)
    expect(await exits(renamed)).toBe(true)
    expect(await exits(unmarked, 1000)).toBe(false)
    expect(await exits(live.child, 1000)).toBe(false)
  })

  it('never lists the sweeper itself, even when it runs from inside a lane', {
    timeout: 30_000,
  }, async () => {
    vi.stubEnv('CLAUDE_PID', String(process.pid))
    const mine = await spawnDummy(lane, { marker: { claudeProcessId: process.pid } })
    const startDirectory = process.cwd()
    process.chdir(lane)
    try {
      const listed = listLaneProcesses(repo, undefined).map((entry) => entry.processId)
      expect(listed).toContain(mine.pid)
      expect(listed).not.toContain(process.pid)
    } finally {
      process.chdir(startDirectory)
    }
  })

  it("kills its own and ended sessions' lane processes, never another live session's or an unmarked one", {
    timeout: 30_000,
  }, async () => {
    const lane = await laneOfEveryOwnership()

    sweepLaneProcesses(repo, undefined)

    expect(
      await Promise.all([exits(lane.mine), exits(lane.ended), exits(lane.recycled)]),
    ).toEqual([true, true, true])
    expect(await exits(lane.live, 1000)).toBe(false)
    expect(await exits(lane.unmarked, 1000)).toBe(false)
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
