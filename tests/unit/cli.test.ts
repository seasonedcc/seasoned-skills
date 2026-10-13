import { execFileSync } from 'node:child_process'
import {
  cpSync,
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
import { fakeCommands } from './fake-commands.js'

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

  describe('the browser sweep', () => {
    it('exits 0 when no browser of this session or an ended one is alive', async () => {
      vi.spyOn(process, 'getuid').mockReturnValue(2_147_483_646)

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

      await run('sweep', '--browsers')

      expect(process.exitCode).toBe(1)
      const output = vi.mocked(console.log).mock.calls.join('\n')
      expect(output).toContain(`pid=${mine.pid}`)
      expect(output).toContain('NOT clean')
      expect(isRunning(mine)).toBe(true)
    })

    it('exits 1 and kills nothing when the process table cannot be read', {
      timeout: 30_000,
    }, async () => {
      vi.stubEnv('CLAUDE_PID', String(process.pid))
      const mine = await spawnDummy(root, {
        label: 'agent-browser-linux-x64',
        marker: { claudeProcessId: process.pid },
      })
      fakeCommands(root, {
        ps: 'case "$*" in *lstart*) exit 0 ;; *) exec /bin/ps "$@" ;; esac',
      })

      await run('sweep', '--browsers', '--kill')

      expect(process.exitCode).toBe(1)
      expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
        'cannot read the process table',
      )
      expect(isRunning(mine)).toBe(true)
    })
  })
})
