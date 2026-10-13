import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'
import {
  exits,
  isRunning,
  spawnDummy,
  spawnSessionWithChild,
  stopDummies,
} from './dummy-processes.js'
import { browserListingOf, fakeBrowserPs } from './fake-commands.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})

const { readFileSync: realReadFileSync } =
  await vi.importActual<typeof import('node:fs')>('node:fs')

const fixture = fileURLToPath(new URL('../golden/fixtures/cli-package/', import.meta.url))

function run(...args: string[]) {
  return buildProgram().parseAsync(args, { from: 'user' })
}

describe('the CLI program', () => {
  let root: string
  const startDirectory = process.cwd()

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-cli-'))
    process.chdir(root)
    // Sync weaves in whatever the machine's corpus cache holds; pointing the
    // cache root inside the temp project keeps these runs off the real one.
    vi.stubEnv('XDG_CACHE_HOME', join(root, 'cache'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    stopDummies()
    rmSync(`${root}-worktrees`, { recursive: true, force: true })
    process.chdir(startDirectory)
    process.exitCode = undefined
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  function scaffoldProject() {
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
    const packageEntry = fileURLToPath(new URL('../../src/index.ts', import.meta.url))
    const config = readFileSync(join(fixture, 'seasoned-skills.config.ts'), 'utf8')
    writeFileSync(
      join(root, 'seasoned-skills.config.ts'),
      config.replace('../../../../src/index.js', packageEntry),
    )
    cpSync(join(fixture, 'workflow-content'), join(root, 'workflow-content'), {
      recursive: true,
    })
  }

  it('sync generates the workflow and reports the count', async () => {
    scaffoldProject()
    await run('sync')
    expect(process.exitCode).toBeUndefined()
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true)
    expect(vi.mocked(console.log).mock.calls.join('\n')).toMatch(/Generated \d+ files/)
  })

  it('sync degrades to the repair kit and exits 1 on broken inputs', async () => {
    scaffoldProject()
    await run('sync')
    writeFileSync(join(root, 'workflow-content/qiuck.md'), 'A typo nothing loads.\n')
    await run('sync')
    expect(process.exitCode).toBe(1)
    expect(existsSync(join(root, '.claude/skills/quick'))).toBe(false)
    expect(existsSync(join(root, '.claude/skills/seasoned-skills/SKILL.md'))).toBe(true)
    expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('repair kit')
  })

  it('doctor stays exit 0 without a loadable configuration', async () => {
    await run('doctor')
    expect(process.exitCode).toBeUndefined()
    const output = vi.mocked(console.log).mock.calls.join('\n')
    expect(output).toContain('Doctor could not derive its checklist')
    expect(output).toContain('Shaping corpus cache')
  })

  it('doctor reports the derived checklist for a loadable configuration', async () => {
    scaffoldProject()
    await run('doctor')
    expect(process.exitCode).toBeUndefined()
    expect(vi.mocked(console.log).mock.calls.join('\n')).toContain('git')
  })

  it('sweep without a target errors', async () => {
    await run('sweep')
    expect(process.exitCode).toBe(1)
    expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('--browsers')
  })

  it('provision fails loud without a configuration', async () => {
    await run('provision', 'my-lane')
    expect(process.exitCode).toBe(1)
  })

  it('provision collects every --repo and refuses an undeclared one', async () => {
    scaffoldProject()
    execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
      cwd: root,
    })

    // The undeclared path comes first: a collector that kept only the last
    // value would carry "." alone and never reach this error.
    await run('provision', 'my-lane', '--repo', '../engine', '--repo', '.')

    expect(process.exitCode).toBe(1)
    expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
      '--repo ../engine matches no repository declared in seasoned-skills.config.ts; it declares "."',
    )
  })

  it('teardown fails loud without a configuration', async () => {
    await run('teardown', 'my-lane')
    expect(process.exitCode).toBe(1)
  })

  it('lane-process sweep reports when there is nothing to sweep', async () => {
    scaffoldProject()
    execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
      cwd: root,
    })
    await run('sweep', '--lane-processes')
    expect(process.exitCode).toBeUndefined()
    expect(vi.mocked(console.log).mock.calls.join('\n')).toContain(
      'No lane processes to sweep.',
    )
  })

  it('lane-process sweep lists by default and kills only with --kill', {
    timeout: 30_000,
  }, async () => {
    scaffoldProject()
    execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
      cwd: root,
    })
    const lane = join(`${realpathSync(root)}-worktrees`, 'lane-a')
    mkdirSync(lane, { recursive: true })
    vi.stubEnv('CLAUDE_PID', String(process.pid))
    const mine = await spawnDummy(lane, { marker: { claudeProcessId: process.pid } })

    await run('sweep', '--lane-processes')
    const listing = vi.mocked(console.log).mock.calls.join('\n')
    expect(listing).toContain(`${mine.pid}`)
    expect(listing).toContain('mine')
    expect(await exits(mine, 1000)).toBe(false)

    await run('sweep', '--lane-processes', '--kill')
    expect(await exits(mine)).toBe(true)
  })

  it('lane-process sweep tells a refused kill apart from a process that exited', {
    timeout: 30_000,
  }, async () => {
    scaffoldProject()
    execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
      cwd: root,
    })
    const lane = join(`${realpathSync(root)}-worktrees`, 'lane-a')
    mkdirSync(lane, { recursive: true })
    vi.stubEnv('CLAUDE_PID', String(process.pid))
    const mine = await spawnDummy(lane, { marker: { claudeProcessId: process.pid } })
    const deliver = process.kill.bind(process)
    vi.spyOn(process, 'kill').mockImplementation((processId, signal) => {
      if (processId === mine.pid && signal === 'SIGTERM') {
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      }
      return deliver(processId, signal)
    })

    await run('sweep', '--lane-processes', '--kill')

    const output = vi.mocked(console.log).mock.calls.join('\n')
    expect(output).toMatch(new RegExp(`kill failed +${mine.pid} `))
    expect(output).toContain('Terminated 0 of 1 process found in lanes.')
    expect(isRunning(mine)).toBe(true)
  })

  describe('the session-end hook', () => {
    async function laneWithOwnAndLiveProcesses() {
      scaffoldProject()
      execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
        cwd: root,
      })
      const lane = join(`${realpathSync(root)}-worktrees`, 'lane-a')
      mkdirSync(lane, { recursive: true })
      vi.stubEnv('CLAUDE_PID', String(process.pid))
      const [mine, live] = await Promise.all([
        spawnDummy(lane, { marker: { claudeProcessId: process.pid } }),
        spawnSessionWithChild(lane, 'other-session'),
      ])
      return { mine, live: live.child }
    }

    function endSessionWith(reason: string) {
      vi.mocked(readFileSync).mockImplementation((path, options) =>
        path === 0
          ? JSON.stringify({ reason })
          : realReadFileSync(path, options as BufferEncoding),
      )
    }

    afterEach(() => {
      vi.mocked(readFileSync).mockImplementation(realReadFileSync)
    })

    it('kills nothing without --kill, even when the session is over', {
      timeout: 30_000,
    }, async () => {
      const { mine } = await laneWithOwnAndLiveProcesses()
      endSessionWith('prompt_input_exit')

      await run('sweep', '--lane-processes', '--hook')

      expect(await exits(mine, 1000)).toBe(false)
      expect(process.exitCode).toBeUndefined()
    })

    it("kills its own lane processes when the session is over, never another live session's", {
      timeout: 30_000,
    }, async () => {
      const { mine, live } = await laneWithOwnAndLiveProcesses()
      endSessionWith('prompt_input_exit')

      await run('sweep', '--lane-processes', '--kill', '--hook')

      expect(await exits(mine)).toBe(true)
      expect(await exits(live, 1000)).toBe(false)
      expect(vi.mocked(console.log)).not.toHaveBeenCalled()
    })

    it('kills nothing when the session merely clears or resumes', {
      timeout: 30_000,
    }, async () => {
      const { mine } = await laneWithOwnAndLiveProcesses()
      endSessionWith('clear')

      await run('sweep', '--lane-processes', '--kill', '--hook')

      expect(await exits(mine, 1000)).toBe(false)
    })
  })

  describe('session folders', () => {
    const KEPT = '11111111-1111-4111-8111-111111111111'
    const EXPIRED = '22222222-2222-4222-8222-222222222222'
    let projects: string
    let sessions: string

    beforeEach(() => {
      execFileSync('git', ['init', '--quiet'], { cwd: root })
      const configDirectory = join(root, 'claude-config')
      projects = join(configDirectory, 'projects')
      sessions = join(realpathSync(root), '.sessions')
      vi.stubEnv('CLAUDE_CONFIG_DIR', configDirectory)
    })

    afterEach(() => {
      for (const directory of [projects, sessions]) {
        if (existsSync(directory)) chmodSync(directory, 0o755)
      }
    })

    function transcript(sessionId: string, inProjects = projects) {
      mkdirSync(join(inProjects, '-project'), { recursive: true })
      const path = join(inProjects, '-project', `${sessionId}.jsonl`)
      writeFileSync(path, '{}\n')
      return path
    }

    /** A worktree of a bare repository: a checkout with no main checkout behind it. */
    function bareRepositoryWorktree() {
      const origin = join(root, 'origin')
      mkdirSync(origin)
      execFileSync('git', ['init', '--quiet'], { cwd: origin })
      execFileSync(
        'git',
        [
          '-c',
          'user.email=t@example.com',
          '-c',
          'user.name=T',
          'commit',
          '--allow-empty',
          '--quiet',
          '-m',
          'root',
        ],
        { cwd: origin },
      )
      const bare = join(root, 'bare.git')
      execFileSync('git', ['clone', '--quiet', '--bare', origin, bare])
      const worktree = join(root, 'bare-worktree')
      execFileSync('git', ['worktree', 'add', '--quiet', worktree], { cwd: bare })
      return worktree
    }

    function identityOf(projectsDirectory: string) {
      try {
        const { ino } = statSync(projectsDirectory, { bigint: true })
        return `inode ${ino}`
      } catch {
        return 'inode 0'
      }
    }

    function folderOf(sessionId: string, recordedTranscript?: string) {
      const folder = join(sessions, sessionId)
      mkdirSync(folder, { recursive: true })
      if (recordedTranscript !== undefined) {
        writeFileSync(
          join(folder, '.transcript'),
          `${recordedTranscript}\n${identityOf(dirname(dirname(recordedTranscript)))}\n`,
        )
      }
      return folder
    }

    /** A folder whose recorded transcript Claude Code has since deleted. */
    function expiredFolderOf(sessionId: string) {
      const gone = transcript(sessionId)
      const folder = folderOf(sessionId, gone)
      rmSync(gone)
      return folder
    }

    it("session-folder prints this session's folder, recording its transcript", async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', KEPT)
      const own = transcript(KEPT)

      await run('session-folder')

      const folder = join(sessions, KEPT)
      expect(process.exitCode).toBeUndefined()
      expect(vi.mocked(console.log).mock.calls).toEqual([[folder]])
      expect(vi.mocked(console.error)).not.toHaveBeenCalled()
      expect(readFileSync(join(folder, '.transcript'), 'utf8')).toBe(
        `${own}\n${identityOf(projects)}\n`,
      )
    })

    it('session-folder still prints the folder, and says so, when no transcript is found', async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', KEPT)

      await run('session-folder')

      const folder = join(sessions, KEPT)
      expect(process.exitCode).toBeUndefined()
      expect(vi.mocked(console.log).mock.calls).toEqual([[folder]])
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        'records no transcript',
      )
      expect(existsSync(join(folder, '.transcript'))).toBe(false)
    })

    it('session-folder says nothing is recorded when the folder holds an empty record', async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', KEPT)
      writeFileSync(join(folderOf(KEPT), '.transcript'), '')

      await run('session-folder')

      expect(process.exitCode).toBeUndefined()
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        'records no transcript',
      )
    })

    it('keeps a folder when another configuration asks for it or sweeps it', async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', KEPT)
      const own = transcript(KEPT)
      await run('session-folder')
      const folder = join(sessions, KEPT)

      mkdirSync(join(root, 'other-config', 'projects'), { recursive: true })
      vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'other-config'))
      await run('session-folder')
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', '')
      await run('sweep', '--sessions', '--remove')

      expect(process.exitCode).toBeUndefined()
      expect(readFileSync(join(folder, '.transcript'), 'utf8')).toBe(
        `${own}\n${identityOf(projects)}\n`,
      )
      expect(existsSync(folder)).toBe(true)
    })

    it('keeps a folder whose configuration moved away while another took its place', async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', KEPT)
      transcript(KEPT)
      await run('session-folder')
      const folder = join(sessions, KEPT)
      renameSync(join(root, 'claude-config'), join(root, 'moved-config'))
      vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'moved-config'))
      transcript(EXPIRED)

      await run('sweep', '--sessions', '--remove')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        `the projects directory at ${projects} is not the one this folder recorded`,
      )
      expect(existsSync(folder)).toBe(true)
    })

    it('session-folder exits 1 in a checkout with no main checkout behind it', async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', KEPT)
      const worktree = bareRepositoryWorktree()
      process.chdir(worktree)

      await run('session-folder')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        'has no main checkout to keep session folders in',
      )
      expect(existsSync(join(root, '.sessions'))).toBe(false)
    })

    it('the session-end hook stays silent in a checkout with no main checkout behind it', async () => {
      process.chdir(bareRepositoryWorktree())

      await run('sweep', '--sessions', '--remove', '--hook')

      expect(process.exitCode).toBeUndefined()
      expect(vi.mocked(console.log)).not.toHaveBeenCalled()
      expect(vi.mocked(console.error)).not.toHaveBeenCalled()
    })

    it('sweep refuses flags that do not apply to what it sweeps', async () => {
      const expired = expiredFolderOf(EXPIRED)
      const refusals: [string[], string][] = [
        [['--sessions', '--kill'], '--kill'],
        [['--sessions', '--lane', 'lane-a'], '--lane'],
        [['--sessions', '--remove', '--lane-processes'], 'one of'],
        [['--lane-processes', '--remove'], '--remove'],
        [['--browsers', '--remove'], '--remove'],
        [['--browsers', '--sessions'], 'one of'],
      ]
      for (const [flags, named] of refusals) {
        process.exitCode = undefined
        vi.mocked(console.error).mockClear()

        await run('sweep', ...flags)

        expect(process.exitCode, flags.join(' ')).toBe(1)
        expect(vi.mocked(console.error).mock.calls.join('\n'), flags.join(' ')).toContain(
          named,
        )
      }
      expect(existsSync(expired)).toBe(true)
    })

    it('session-folder exits 1 outside a Claude Code session', async () => {
      await run('session-folder')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        'CLAUDE_CODE_SESSION_ID is not set',
      )
      expect(existsSync(join(root, '.sessions'))).toBe(false)
    })

    it('session-folder exits 1 for an id that is not a session id', async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', '../escape')

      await run('session-folder')

      expect(process.exitCode).toBe(1)
      expect(existsSync(join(root, '.sessions'))).toBe(false)
    })

    it('sweep --sessions lists the expired folders and removes them only with --remove', async () => {
      const kept = folderOf(KEPT, transcript(KEPT))
      const expired = expiredFolderOf(EXPIRED)
      const unrecorded = folderOf('33333333-3333-4333-8333-333333333333')

      await run('sweep', '--sessions')
      const listing = vi.mocked(console.log).mock.calls.join('\n')
      expect(process.exitCode).toBeUndefined()
      expect(listing).toContain(`expired     ${expired}`)
      expect(listing).toContain(`unrecorded  ${unrecorded}`)
      expect(listing).not.toContain(kept)
      expect(existsSync(expired)).toBe(true)

      vi.mocked(console.log).mockClear()
      await run('sweep', '--sessions', '--remove')
      const output = vi.mocked(console.log).mock.calls.join('\n')
      expect(output).toContain(`removed ${expired}`)
      expect(output).toContain('Expired: 0 of 2 session folders')
      expect(process.exitCode).toBeUndefined()
      expect(existsSync(expired)).toBe(false)
      expect([kept, unrecorded].every(existsSync)).toBe(true)
    })

    it('sweep --sessions exits 1 and removes nothing when a transcript cannot be checked', async () => {
      const unmounted = join(
        root,
        'unmounted',
        'projects',
        '-project',
        `${EXPIRED}.jsonl`,
      )
      const undecided = folderOf(EXPIRED, unmounted)

      await run('sweep', '--sessions', '--remove')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        `cannot read Claude Code's projects directory ${join(root, 'unmounted', 'projects')}`,
      )
      expect(vi.mocked(console.log).mock.calls.join('\n')).toContain(
        `undecided   ${undecided}`,
      )
      expect(existsSync(undecided)).toBe(true)
    })

    it('sweep --sessions exits 1 when an expired folder cannot be removed', async () => {
      const expired = expiredFolderOf(EXPIRED)
      chmodSync(sessions, 0o555)

      await run('sweep', '--sessions', '--remove')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        `could not remove ${expired}`,
      )
      expect(existsSync(expired)).toBe(true)
    })

    it('sweep --sessions exits 1 when the sessions directory cannot be read', async () => {
      expiredFolderOf(EXPIRED)
      chmodSync(sessions, 0o000)

      await run('sweep', '--sessions')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('EACCES')
      expect(vi.mocked(console.log).mock.calls.join('\n')).not.toContain('Expired:')
    })

    it('the session-end hook removes the expired folders quietly', async () => {
      const kept = folderOf(KEPT, transcript(KEPT))
      const expired = expiredFolderOf(EXPIRED)

      await run('sweep', '--sessions', '--hook')
      expect(existsSync(expired)).toBe(true)

      await run('sweep', '--sessions', '--remove', '--hook')
      expect(existsSync(expired)).toBe(false)
      expect(existsSync(kept)).toBe(true)
      expect(process.exitCode).toBeUndefined()
      expect(vi.mocked(console.log)).not.toHaveBeenCalled()
    })

    it('the session-end hook keeps the folder of a session whose transcript moved to another project directory', async () => {
      const recorded = transcript(KEPT)
      const folder = folderOf(KEPT, recorded)
      mkdirSync(join(projects, '-project-worktrees-lane-a'))
      renameSync(recorded, join(projects, '-project-worktrees-lane-a', `${KEPT}.jsonl`))

      await run('sweep', '--sessions', '--remove', '--hook')

      expect(existsSync(folder)).toBe(true)
    })

    it('the session-end hook stays silent when it can remove or check nothing', async () => {
      const expired = expiredFolderOf(EXPIRED)
      const undecided = folderOf(
        KEPT,
        join(root, 'unmounted', 'projects', '-project', `${KEPT}.jsonl`),
      )
      chmodSync(sessions, 0o555)

      await run('sweep', '--sessions', '--remove', '--hook')

      expect([expired, undecided].every(existsSync)).toBe(true)
      expect(process.exitCode).toBeUndefined()
      expect(vi.mocked(console.log)).not.toHaveBeenCalled()
      expect(vi.mocked(console.error)).not.toHaveBeenCalled()
    })
  })

  describe('the browser sweep', () => {
    it('exits 0 when no browser of this session or an ended one is alive', async () => {
      fakeBrowserPs(root, { browsers: browserListingOf([]) })

      await run('sweep', '--browsers')
      expect(process.exitCode).toBeUndefined()
      await run('sweep', '--browsers', '--kill')
      expect(process.exitCode).toBeUndefined()

      expect(vi.mocked(console.log).mock.calls.join('\n')).toContain('SWEEP: clean')
    })

    it('exits 1 while a browser of this session is alive', {
      timeout: 30_000,
    }, async () => {
      vi.stubEnv('CLAUDE_PID', String(process.pid))
      const mine = await spawnDummy(root, {
        label: 'agent-browser-linux-x64',
        marker: { claudeProcessId: process.pid },
      })
      fakeBrowserPs(root, { browsers: browserListingOf([mine]) })

      await run('sweep', '--browsers')

      expect(process.exitCode).toBe(1)
      const output = vi.mocked(console.log).mock.calls.join('\n')
      expect(output).toContain(`pid=${mine.pid}`)
      expect(output).toContain('NOT clean')
      expect(isRunning(mine)).toBe(true)
    })

    it('kills a browser of this session with --kill and then reports clean', {
      timeout: 30_000,
    }, async () => {
      vi.stubEnv('CLAUDE_PID', String(process.pid))
      const mine = await spawnDummy(root, {
        label: 'agent-browser-linux-x64',
        marker: { claudeProcessId: process.pid },
      })
      fakeBrowserPs(root, { browsers: browserListingOf([mine]) })

      await run('sweep', '--browsers', '--kill')

      expect(await exits(mine)).toBe(true)
      expect(process.exitCode).toBeUndefined()
      const output = vi.mocked(console.log).mock.calls.join('\n')
      expect(output).toContain(`killed pid=${mine.pid}`)
      expect(output).toContain('SWEEP: clean')
    })

    it('exits 1 and kills nothing when the browsers cannot be listed', {
      timeout: 30_000,
    }, async () => {
      fakeBrowserPs(root, { browsers: "echo 'ps: no such option' >&2; exit 1" })

      await run('sweep', '--browsers', '--kill')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        'ps could not list the browser processes: ps: no such option',
      )
      expect(vi.mocked(console.log).mock.calls.join('\n')).not.toContain('SWEEP')
    })

    it('exits 1 and kills nothing when the process table cannot be read', {
      timeout: 30_000,
    }, async () => {
      vi.stubEnv('CLAUDE_PID', String(process.pid))
      const mine = await spawnDummy(root, {
        label: 'agent-browser-linux-x64',
        marker: { claudeProcessId: process.pid },
      })
      fakeBrowserPs(root, { browsers: browserListingOf([mine]), table: 'exit 0' })

      await run('sweep', '--browsers', '--kill')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        'cannot read the process table',
      )
      expect(isRunning(mine)).toBe(true)
    })
  })
})
