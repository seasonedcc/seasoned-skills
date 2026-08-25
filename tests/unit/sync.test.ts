import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readManifest } from '../../src/sync/manifest.js'
import { degrade, ignoreEntries, SyncInputError, sync } from '../../src/sync/sync.js'

const fixture = fileURLToPath(new URL('../golden/fixtures/cli-package/', import.meta.url))

describe('sync', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-sync-'))
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    // The fixture config imports defineConfig relatively; the copy needs the
    // absolute module path to resolve from the temp directory.
    const packageEntry = fileURLToPath(new URL('../../src/index.ts', import.meta.url))
    const config = readFileSync(join(fixture, 'seasoned-skills.config.ts'), 'utf8')
    writeFileSync(
      join(root, 'seasoned-skills.config.ts'),
      config.replace('../../../../src/index.js', packageEntry),
    )
    cpSync(join(fixture, 'workflow-content'), join(root, 'workflow-content'), {
      recursive: true,
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('materializes the whole workflow and manages the footprint', async () => {
    writeFileSync(join(root, 'package.json'), '{"name":"consumer"}\n')
    const result = await sync(root, { corpusCache: join(root, 'no-corpus-cache') })
    expect(result.generated).toContain('CLAUDE.md')
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('# seasoned-skills')
    expect(existsSync(join(root, '.claude/skills/quick/SKILL.md'))).toBe(true)
    expect(existsSync(join(root, '.claude/skills/seasoned-skills/SKILL.md'))).toBe(true)
    expect(statSync(join(root, '.claude/statusline.sh')).mode & 0o111).not.toBe(0)

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
    expect(gitignore).toContain('CLAUDE.md')
    expect(gitignore).toContain('.claude/skills/quick/')
    expect(gitignore).toContain('.claude/seasoned-skills-manifest.json')

    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'))
    expect(settings.skillListingBudgetFraction).toBe(0.02)
    expect(settings.permissions.defaultMode).toBe('auto')

    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(manifest.scripts.prepare).toBe('seasoned-skills sync')

    expect(readManifest(root).length).toBeGreaterThan(20)
  })

  it('is idempotent and deletes what a change stops generating', async () => {
    await sync(root, { corpusCache: join(root, 'no-corpus-cache') })
    const first = readManifest(root)

    // Simulate a file a previous version generated that this one does not.
    const stale = '.claude/skills/retired-skill/SKILL.md'
    writeFileSync(
      join(root, '.claude/seasoned-skills-manifest.json'),
      JSON.stringify([...first, stale]),
    )
    writeFileSync(join(root, stale.replace('/SKILL.md', '')), '')
    rmSync(join(root, stale.replace('/SKILL.md', '')))
    execFileSync('mkdir', ['-p', join(root, '.claude/skills/retired-skill')])
    writeFileSync(join(root, stale), 'stale')

    await sync(root, { corpusCache: join(root, 'no-corpus-cache') })
    expect(readManifest(root)).toEqual(first)
    expect(existsSync(join(root, stale))).toBe(false)
  })

  it('generates everything when the project owns no content at all', async () => {
    rmSync(join(root, 'workflow-content'), { recursive: true })
    const result = await sync(root, { corpusCache: join(root, 'no-corpus-cache') })
    expect(result.generated).toContain('CLAUDE.md')
    expect(existsSync(join(root, '.claude/skills/quick/SKILL.md'))).toBe(true)
    expect(
      readFileSync(join(root, '.claude/skills/quick/SKILL.md'), 'utf8'),
    ).not.toContain('## Project specifics')
  })

  it('fails loud listing every unrecognized content file at once', async () => {
    writeFileSync(join(root, 'workflow-content/qiuck.md'), 'A typo nothing loads.\n')
    writeFileSync(join(root, 'workflow-content/scratch.md'), 'An aside.\n')
    const error = await sync(root, { corpusCache: join(root, 'no-corpus-cache') }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(SyncInputError)
    expect((error as SyncInputError).message).toContain('workflow-content/qiuck.md')
    expect((error as SyncInputError).message).toContain('workflow-content/scratch.md')
  })

  it('recognizes disabled skills, configured files, and ignores subdirectories', async () => {
    // kysely generates only for a project that declares a stack; this fixture
    // does not, and the file it would leave behind must not fail the sync.
    writeFileSync(join(root, 'workflow-content/kysely.md'), 'Stack notes.\n')
    writeFileSync(join(root, 'workflow-content/calibrations.md'), 'Calibrations.\n')
    mkdirSync(join(root, 'workflow-content/notes'))
    writeFileSync(join(root, 'workflow-content/notes/anything.md'), 'An aside.\n')
    const result = await sync(root, { corpusCache: join(root, 'no-corpus-cache') })
    expect(result.generated).toContain('CLAUDE.md')
  })

  it('degrades to the repair kit and a standing-order doctrine file', async () => {
    await sync(root, { corpusCache: join(root, 'no-corpus-cache') })
    writeFileSync(join(root, 'workflow-content/qiuck.md'), 'A typo nothing loads.\n')
    const error = (await sync(root, { corpusCache: join(root, 'no-corpus-cache') }).catch(
      (e: unknown) => e,
    )) as Error
    degrade(root, error)

    expect(existsSync(join(root, '.claude/skills/quick'))).toBe(false)
    expect(existsSync(join(root, '.claude/skills/seasoned-skills/SKILL.md'))).toBe(true)
    const doctrine = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    expect(doctrine).toContain('could not be generated')
    expect(doctrine).toContain('Standing order')
    expect(doctrine).toContain('workflow-content/qiuck.md')
  })
})

describe('ignoreEntries', () => {
  it('compacts generated paths into skill folders and keeps the manifest', () => {
    const entries = ignoreEntries([
      'CLAUDE.md',
      '.claude/skills/quick/SKILL.md',
      '.claude/skills/quick/reference.md',
      'shaping/assets/style.css',
    ])
    expect(entries).toContain('CLAUDE.md')
    expect(entries).toContain('.claude/skills/quick/')
    expect(entries).toContain('shaping/assets/')
    expect(entries).toContain('.claude/seasoned-skills-manifest.json')
    expect(entries).not.toContain('.claude/skills/quick/SKILL.md')
  })

  it("carries the meeting skill's per-user configuration", () => {
    expect(ignoreEntries([])).toContain('requests-from-meetings/config.local.json')
  })

  it('carries the finished demo video copied beside its screenplay', () => {
    expect(ignoreEntries([])).toContain('/demo-videos/*/*.mp4')
  })
})
