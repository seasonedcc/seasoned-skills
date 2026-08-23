import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GeneratedFile } from './types.js'

/**
 * The verbatim-materialized runtime assets: deterministic code the package
 * ships whole — the hooks, the status line, the watchdog — copied byte for
 * byte to each project's generated (and gitignored) paths. Prose is woven;
 * runtime code is materialized.
 */
const runtimeRoot = fileURLToPath(new URL('../../runtime/', import.meta.url))

export function runtimeFile(relativePath: string): Uint8Array {
  return readFileSync(join(runtimeRoot, relativePath))
}

export function materializeRuntime(): GeneratedFile[] {
  const files: GeneratedFile[] = [
    {
      path: '.claude/statusline.sh',
      contents: runtimeFile('statusline.sh'),
      executable: true,
    },
    {
      path: '.claude/hooks/block-git-stash.sh',
      contents: runtimeFile('hooks/block-git-stash.sh'),
      executable: true,
    },
    {
      path: '.claude/hooks/isolation-guard.sh',
      contents: runtimeFile('hooks/isolation-guard.sh'),
      executable: true,
    },
    {
      path: '.claude/hooks/session-end-sweep.sh',
      contents: runtimeFile('hooks/session-end-sweep.sh'),
      executable: true,
    },
    {
      path: '.claude/skills/subagents/scripts/watchdog.py',
      contents: runtimeFile('watchdog.py'),
    },
    ...runtimeTree('shaping-assets', 'shaping/assets'),
  ]
  return files
}

/** Maps a whole runtime directory onto a generated path, byte for byte. */
export function runtimeTree(sourceDir: string, targetDir: string): GeneratedFile[] {
  const root = join(runtimeRoot, sourceDir)
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = join(entry.parentPath, entry.name)
      const relative = absolute.slice(root.length + 1)
      return { path: join(targetDir, relative), contents: readFileSync(absolute) }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}
