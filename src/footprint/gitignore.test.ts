import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureIgnored, readManagedBlock, updateManagedBlock } from './gitignore.js'

describe('updateManagedBlock', () => {
  it('appends a managed block to an existing file', () => {
    const result = updateManagedBlock('node_modules/\n', ['CLAUDE.md', '.claude/hooks/'])
    expect(result).toBe(
      [
        'node_modules/',
        '# >>> seasoned-skills (managed block, do not edit) >>>',
        'CLAUDE.md',
        '.claude/hooks/',
        '# <<< seasoned-skills <<<',
        '',
      ].join('\n'),
    )
  })

  it('rewrites an existing block in place, leaving the rest untouched', () => {
    const existing = updateManagedBlock('node_modules/\n', ['old-entry'])
    const withTail = `${existing}dist/\n`
    const result = updateManagedBlock(withTail, ['new-entry'])
    expect(result).toContain('node_modules/')
    expect(result).toContain('dist/')
    expect(result).toContain('new-entry')
    expect(result).not.toContain('old-entry')
    expect(readManagedBlock(result)).toEqual(['new-entry'])
  })

  it('round-trips through readManagedBlock', () => {
    const result = updateManagedBlock('', ['a', 'b'])
    expect(readManagedBlock(result)).toEqual(['a', 'b'])
  })
})

describe('ensureIgnored', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-gitignore-'))
    execFileSync('git', ['init', '--quiet'], { cwd: root })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('adds only the paths git does not already ignore', () => {
    writeFileSync(join(root, '.gitignore'), 'already-ignored.md\n')
    const entries = ensureIgnored(root, ['already-ignored.md', 'CLAUDE.md'])
    expect(entries).toEqual(['CLAUDE.md'])
    const file = readFileSync(join(root, '.gitignore'), 'utf8')
    expect(file).toContain('already-ignored.md')
    expect(file).toContain('CLAUDE.md')
  })

  it('is idempotent', () => {
    ensureIgnored(root, ['CLAUDE.md'])
    const first = readFileSync(join(root, '.gitignore'), 'utf8')
    ensureIgnored(root, ['CLAUDE.md'])
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(first)
  })

  it('fails loud when a negation elsewhere re-exposes a managed path', () => {
    writeFileSync(join(root, '.gitignore'), '')
    // A negation AFTER the managed block wins over the block's entries.
    ensureIgnored(root, ['CLAUDE.md'])
    const file = readFileSync(join(root, '.gitignore'), 'utf8')
    writeFileSync(join(root, '.gitignore'), `${file}!CLAUDE.md\n`)
    expect(() => ensureIgnored(root, ['CLAUDE.md'])).toThrow('still not ignored')
  })
})
