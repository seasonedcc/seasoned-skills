import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentFile, ProjectContent } from './types.js'

/**
 * Loads the project-owned content directory: one markdown file per generated
 * skill plus one for the doctrine layer. Every file is optional — an absent
 * one simply means the project has nothing to add there. Only the top level
 * loads, so a subdirectory is free space the project may use for anything.
 */
export function loadProjectContent(
  projectRoot: string,
  contentDir: string,
): ProjectContent {
  const directory = join(projectRoot, contentDir)
  const files = new Map<string, ContentFile>()
  if (existsSync(directory)) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const name = entry.name.slice(0, -3)
      files.set(name, parseContentFile(readFileSync(join(directory, entry.name), 'utf8')))
    }
  }
  return { files }
}

/**
 * A content file is markdown with an optional minimal front matter block
 * carrying the skill's project trigger vocabulary.
 */
export function parseContentFile(raw: string): ContentFile {
  if (!raw.startsWith('---\n')) return { body: raw.trim() }
  const end = raw.indexOf('\n---', 4)
  if (end === -1) return { body: raw.trim() }
  const header = raw.slice(4, end)
  const body = raw
    .slice(end + 4)
    .replace(/^\n/, '')
    .trim()
  const triggersMatch = header.match(/^triggers:\s*(.+)$/m)
  return triggersMatch?.[1] ? { triggers: triggersMatch[1].trim(), body } : { body }
}
