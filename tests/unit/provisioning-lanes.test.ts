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
import { provisionLane, teardownLane } from '../../src/provisioning/index.js'
import {
  readTemplateFingerprint,
  writeTemplateFingerprint,
} from '../../src/provisioning/template.js'

function initRepo(path: string) {
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: path })
  execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
    cwd: path,
  })
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
    expect(result.seed).toContain('skipped')
    expect(result.summary).toContain('Lane quick-fix ready')
    // Idempotent: a re-run reuses the registered worktree.
    await provisionLane(repo, undefined, 'quick-fix', { skipProvision: true })
  })

  it('provisions a full lane, running steps with the allocation environment', async () => {
    const config = {
      repositories: [{ path: '.', provisionSteps: ['echo "PORT=$APP" > step-ran.txt'] }],
      portBases: { app: 4600 },
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
    expect(result.seed).toBe('not applicable (no databases declared)')

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
