import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GeneratedFile } from '../generation/types.js'

/**
 * The machine's corpus cache. Every built corpus lives only on the machine
 * that built it — never in any project's recorded history. The cache mirrors
 * the layout the corpus scripts expect (sources/ beside skill/references/),
 * so the scripts run against it verbatim, and sync weaves whatever the cache
 * holds into each project's generated shaping skill.
 */
export function corpusCacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME
  const base = xdg && xdg !== '' ? xdg : join(homedir(), '.cache')
  return join(base, 'seasoned-skills', 'corpus')
}

export function corpusReferencesDir(cacheRoot: string): string {
  return join(cacheRoot, 'skill', 'references')
}

/** What the cache says built it — doctor calls a mismatch with the running package stale. */
export function corpusBuiltBy(cacheRoot: string): string | undefined {
  const marker = join(cacheRoot, 'built-by.json')
  if (!existsSync(marker)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(marker, 'utf8'))
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

/** The cached corpus, mapped to the generated shaping skill's references tree. */
export function materializeCorpus(cacheRoot: string): GeneratedFile[] {
  const references = corpusReferencesDir(cacheRoot)
  if (!existsSync(references)) return []
  return readdirSync(references, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = join(entry.parentPath, entry.name)
      const relative = absolute.slice(references.length + 1)
      return {
        path: join('.claude/skills/shaping/references', relative),
        contents: readFileSync(absolute),
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}
