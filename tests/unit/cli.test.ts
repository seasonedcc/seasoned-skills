import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'

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
})
