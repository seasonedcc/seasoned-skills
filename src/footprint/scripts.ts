import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The one managed script entry: the project's own prepare script runs
 * `seasoned-skills sync` on every install, so a fresh clone materializes the
 * whole workflow and a version bump regenerates everything on the next
 * install. It is deliberately the project's script, not a package lifecycle
 * hook — the pinned package manager blocks dependency lifecycle scripts by
 * default, and a sync that silently does not run is worse than none.
 *
 * Sync re-asserts this entry; creating a manifest where none exists is the
 * install's job, so a missing package.json is left alone.
 */
export const SYNC_COMMAND = 'seasoned-skills sync'

export function ensureSyncScript(projectRoot: string): void {
  const file = join(projectRoot, 'package.json')
  if (!existsSync(file)) return

  const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
    scripts?: Record<string, string>
  }
  const scripts = manifest.scripts ?? {}
  const prepare = scripts.prepare

  if (prepare?.includes(SYNC_COMMAND)) return
  scripts.prepare = prepare ? `${prepare} && ${SYNC_COMMAND}` : SYNC_COMMAND
  manifest.scripts = scripts
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
}
