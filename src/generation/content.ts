import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentFile, ProjectContent } from './types.js'

/**
 * Every file the content directory's top level holds, whatever its extension:
 * what the loader reads from, and what the sync guard judges. A symlink counts
 * as the file it points at, so content kept elsewhere and linked in loads like
 * any other; a subdirectory never counts, so it stays free space the project
 * may use for anything.
 */
export function contentFileNames(projectRoot: string, contentDir: string): string[] {
  const directory = join(projectRoot, contentDir)
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) =>
      statSync(join(directory, name), { throwIfNoEntry: false })?.isFile(),
    )
}

/**
 * The top-level entries that point at nothing: a link whose target is gone.
 * They are files to nobody, so contentFileNames passes over them — the sync
 * guard names them itself, rather than let a moved target silently drop the
 * content the link stands for.
 */
export function danglingContentNames(projectRoot: string, contentDir: string): string[] {
  const directory = join(projectRoot, contentDir)
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isSymbolicLink() &&
        !statSync(join(directory, entry.name), { throwIfNoEntry: false }),
    )
    .map((entry) => entry.name)
}

/**
 * Loads the project-owned content directory: one markdown file per generated
 * skill plus one for the doctrine layer. Every file is optional — an absent
 * one simply means the project has nothing to add there.
 */
export function loadProjectContent(
  projectRoot: string,
  contentDir: string,
): ProjectContent {
  const directory = join(projectRoot, contentDir)
  const files = new Map<string, ContentFile>()
  for (const fileName of contentFileNames(projectRoot, contentDir)) {
    if (!fileName.endsWith('.md')) continue
    const name = fileName.slice(0, -'.md'.length)
    files.set(name, parseContentFile(readFileSync(join(directory, fileName), 'utf8')))
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
