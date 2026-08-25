import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readManifest } from '../../src/sync/manifest.js'
import { degrade, ignoreEntries, SyncInputError, sync } from '../../src/sync/sync.js'

const packageEntry = fileURLToPath(new URL('../../src/index.ts', import.meta.url))

describe('sync', () => {
  let root: string

  /** Plants a golden fixture's configuration and content in the temp project. */
  const plant = (fixture: string) => {
    const source = fileURLToPath(
      new URL(`../golden/fixtures/${fixture}/`, import.meta.url),
    )
    // The fixture config imports defineConfig relatively; the copy needs the
    // absolute module path to resolve from the temp directory.
    const config = readFileSync(join(source, 'seasoned-skills.config.ts'), 'utf8')
    writeFileSync(
      join(root, 'seasoned-skills.config.ts'),
      config.replace('../../../../src/index.js', packageEntry),
    )
    cpSync(join(source, 'workflow-content'), join(root, 'workflow-content'), {
      recursive: true,
    })
  }

  const runSync = () => sync(root, { corpusCache: join(root, 'no-corpus-cache') })

  const failedSync = async (): Promise<SyncInputError> => {
    const error = await runSync().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(SyncInputError)
    return error as SyncInputError
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-sync-'))
    execFileSync('git', ['init', '--quiet'], { cwd: root })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('materializes the whole workflow and manages the footprint', async () => {
    plant('cli-package')
    writeFileSync(join(root, 'package.json'), '{"name":"consumer"}\n')
    const result = await runSync()
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
    plant('cli-package')
    await runSync()
    const first = readManifest(root)

    // Simulate a file a previous version generated that this one does not.
    const stale = '.claude/skills/retired-skill/SKILL.md'
    writeFileSync(
      join(root, '.claude/seasoned-skills-manifest.json'),
      JSON.stringify([...first, stale]),
    )
    mkdirSync(join(root, '.claude/skills/retired-skill'))
    writeFileSync(join(root, stale), 'stale')

    await runSync()
    expect(readManifest(root)).toEqual(first)
    expect(existsSync(join(root, stale))).toBe(false)
  })

  it('generates everything when the content directory is empty', async () => {
    plant('cli-package')
    rmSync(join(root, 'workflow-content'), { recursive: true })
    mkdirSync(join(root, 'workflow-content'))
    const result = await runSync()
    expect(result.generated).toContain('CLAUDE.md')
    expect(existsSync(join(root, '.claude/skills/quick/SKILL.md'))).toBe(true)
    expect(
      readFileSync(join(root, '.claude/skills/quick/SKILL.md'), 'utf8'),
    ).not.toContain('## Project specifics')
  })

  it('fails loud when the configured content directory does not exist', async () => {
    plant('cli-package')
    rmSync(join(root, 'workflow-content'), { recursive: true })
    const error = await failedSync()
    expect(error.message).toContain('workflow-content')
    expect(error.message).toContain('does not exist')
  })

  it('fails loud listing every unrecognized content file at once', async () => {
    plant('cli-package')
    writeFileSync(join(root, 'workflow-content/qiuck.md'), 'A typo nothing loads.\n')
    writeFileSync(join(root, 'workflow-content/scratch.md'), 'An aside.\n')
    const error = await failedSync()
    expect(error.message).toContain('workflow-content/qiuck.md')
    expect(error.message).toContain('workflow-content/scratch.md')
  })

  it('fails loud on a top-level file that looks like markdown but is not .md', async () => {
    plant('cli-package')
    writeFileSync(join(root, 'workflow-content/reground.MD'), 'Wrong case.\n')
    writeFileSync(join(root, 'workflow-content/kysely.mdx'), 'Wrong extension.\n')
    writeFileSync(join(root, 'workflow-content/nested-routes.markdown'), 'Also wrong.\n')
    const error = await failedSync()
    expect(error.message).toContain('workflow-content/reground.MD')
    expect(error.message).toContain('workflow-content/kysely.mdx')
    expect(error.message).toContain('workflow-content/nested-routes.markdown')
    expect(error.message).toContain('only .md')
  })

  it('fails loud on a top-level link whose target does not exist', async () => {
    plant('cli-package')
    rmSync(join(root, 'workflow-content/doctrine.md'))
    symlinkSync(
      join(root, 'shared-doctrine.md'),
      join(root, 'workflow-content/doctrine.md'),
    )
    const error = await failedSync()
    expect(error.message).toContain('workflow-content/doctrine.md')
    expect(error.message).toContain('points at nothing')
  })

  it('recognizes disabled skills, configured files, and ignores subdirectories', async () => {
    plant('cli-package')
    // kysely generates only for a project that declares a stack; this fixture
    // does not, and the file it would leave behind must not fail the sync.
    writeFileSync(join(root, 'workflow-content/kysely.md'), 'Stack notes.\n')
    writeFileSync(join(root, 'workflow-content/calibrations.md'), 'Calibrations.\n')
    mkdirSync(join(root, 'workflow-content/notes'))
    writeFileSync(join(root, 'workflow-content/notes/anything.md'), 'An aside.\n')
    const result = await runSync()
    expect(result.generated).toContain('CLAUDE.md')
  })

  it('recognizes a configured file whose path is written with a leading ./', async () => {
    plant('cli-package')
    const config = readFileSync(join(root, 'seasoned-skills.config.ts'), 'utf8')
    writeFileSync(
      join(root, 'seasoned-skills.config.ts'),
      config.replace(
        "calibrationFile: 'workflow-content/calibrations.md'",
        "calibrationFile: './workflow-content/calibrations.md'",
      ),
    )
    writeFileSync(join(root, 'workflow-content/calibrations.md'), 'Calibrations.\n')
    const result = await runSync()
    expect(result.generated).toContain('CLAUDE.md')
  })

  it('recognizes the register files an option leaves behind once it is off', async () => {
    plant('cli-package')
    writeFileSync(
      join(root, 'workflow-content/coverage-register.md'),
      'Unreached surfaces.\n',
    )
    writeFileSync(join(root, 'workflow-content/excused-surfaces.md'), 'Excused.\n')
    const result = await runSync()
    expect(result.generated).toContain('CLAUDE.md')
  })

  it('composes the stack skills whose content files are absent', async () => {
    plant('web-mutable')
    for (const name of [
      'type-safety.md',
      'framework-folder.md',
      'formatting-datetimes.md',
    ]) {
      rmSync(join(root, 'workflow-content', name))
    }
    const result = await runSync()
    expect(result.generated).toContain('.claude/skills/type-safety/SKILL.md')
    expect(result.generated).toContain('.claude/skills/framework-folder/SKILL.md')
    expect(result.generated).toContain('.claude/skills/formatting-datetimes/SKILL.md')
  })

  it('fails loud listing every content file missing a required section', async () => {
    plant('web-mutable')
    writeFileSync(join(root, 'workflow-content/type-safety.md'), 'No reserved section.\n')
    writeFileSync(join(root, 'workflow-content/formatting-datetimes.md'), 'Neither.\n')
    const error = await failedSync()
    expect(error.message).toContain(
      'workflow-content/type-safety.md is missing its required "Key types" section',
    )
    expect(error.message).toContain(
      'workflow-content/formatting-datetimes.md is missing its required "Time-zone model" section',
    )
  })

  it('degrades to the repair kit and a standing-order doctrine file', async () => {
    plant('cli-package')
    await runSync()
    writeFileSync(join(root, 'workflow-content/qiuck.md'), 'A typo nothing loads.\n')
    const error = await failedSync()
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
