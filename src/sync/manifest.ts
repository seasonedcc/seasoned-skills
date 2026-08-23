import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The manifest of generated paths, itself generated and gitignored. It is
 * what lets the next sync delete files a configuration change stopped
 * generating — and what the degraded mode reads to clear every generated
 * file when the inputs are broken.
 */
export const MANIFEST_PATH = '.claude/seasoned-skills-manifest.json'

export function readManifest(projectRoot: string): string[] {
  const file = join(projectRoot, MANIFEST_PATH)
  if (!existsSync(file)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(parsed))
      return parsed.filter((p): p is string => typeof p === 'string')
  } catch {
    // A corrupt manifest just means nothing to clean up by name.
  }
  return []
}

export function writeManifest(projectRoot: string, paths: string[]): void {
  const file = join(projectRoot, MANIFEST_PATH)
  writeFileSync(file, `${JSON.stringify([...paths].sort(), null, 2)}\n`)
}
