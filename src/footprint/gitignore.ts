import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The gitignore footprint manager. Generated files never enter a consuming
 * project's history, and "listed in .gitignore" is not the contract —
 * "effectively ignored" is: a later negation or a nested ignore file can
 * un-ignore a listed path. The manager verifies each path with
 * `git check-ignore`, adds the missing ones to its own managed block, and
 * fails loud when a path stays un-ignored even after being listed.
 */
const BLOCK_START = '# >>> seasoned-skills (managed block, do not edit) >>>'
const BLOCK_END = '# <<< seasoned-skills <<<'

export function updateManagedBlock(existing: string, entries: string[]): string {
  const lines = existing.split('\n')
  const start = lines.indexOf(BLOCK_START)
  const end = lines.indexOf(BLOCK_END)
  const block = entries.length > 0 ? [BLOCK_START, ...entries, BLOCK_END] : []
  if (start !== -1 && end !== -1 && end > start) {
    const before = lines.slice(0, start)
    const after = lines.slice(end + 1)
    return joinLines([...before, ...block, ...after])
  }
  const trimmed = existing.replace(/\n+$/, '')
  return joinLines([...(trimmed === '' ? [] : [trimmed]), ...block])
}

function joinLines(lines: string[]): string {
  const text = lines.join('\n').replace(/\n+$/, '')
  return text === '' ? '' : `${text}\n`
}

export function isEffectivelyIgnored(projectRoot: string, path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], {
      cwd: projectRoot,
      stdio: 'ignore',
    })
    return true
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 1) return false
    throw new Error(
      `git check-ignore failed for ${path} in ${projectRoot} — is this a git repository with git installed?`,
    )
  }
}

/**
 * Ensures every generated path is effectively ignored, listing the missing
 * ones in the managed block. Returns the entries the block now carries.
 */
export function ensureIgnored(projectRoot: string, paths: string[]): string[] {
  const missing = paths.filter((path) => !isEffectivelyIgnored(projectRoot, path))
  const file = join(projectRoot, '.gitignore')
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const currentBlock = readManagedBlock(existing)
  const entries = [...new Set([...currentBlock, ...missing])]
  const updated = updateManagedBlock(existing, entries)
  if (updated !== existing) writeFileSync(file, updated)

  const stillExposed = paths.filter((path) => !isEffectivelyIgnored(projectRoot, path))
  if (stillExposed.length > 0) {
    throw new Error(
      `these generated paths are still not ignored after updating .gitignore — a negation elsewhere is re-exposing them: ${stillExposed.join(', ')}`,
    )
  }
  return entries
}

export function readManagedBlock(existing: string): string[] {
  const lines = existing.split('\n')
  const start = lines.indexOf(BLOCK_START)
  const end = lines.indexOf(BLOCK_END)
  if (start === -1 || end === -1 || end <= start) return []
  return lines.slice(start + 1, end).filter((line) => line.trim() !== '')
}
