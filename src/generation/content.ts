import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentFile, ProjectContent } from './types.js'

/**
 * Loads the project-owned content directory: one markdown file per generated
 * skill plus one for the doctrine layer. Which files are mandatory depends on
 * the configuration; the caller passes the required names and gets every
 * missing one reported at once — sync fails loud, never weaves an empty
 * section.
 */
export function loadProjectContent(
  projectRoot: string,
  contentDir: string,
  requiredNames: string[],
): { content: ProjectContent; missing: string[] } {
  const directory = join(projectRoot, contentDir)
  const files = new Map<string, ContentFile>()
  if (existsSync(directory)) {
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith('.md')) continue
      const name = entry.slice(0, -3)
      files.set(name, parseContentFile(readFileSync(join(directory, entry), 'utf8')))
    }
  }
  const missing = requiredNames.filter((name) => !files.has(name))
  return { content: { files }, missing }
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
