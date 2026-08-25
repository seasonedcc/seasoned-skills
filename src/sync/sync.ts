import { rmdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { loadConfig } from '../config/load.js'
import type { SeasonedSkillsConfig } from '../config/types.js'
import { corpusCacheRoot, materializeCorpus } from '../corpus/cache.js'
import { ensureIgnored } from '../footprint/gitignore.js'
import { ensureSyncScript } from '../footprint/scripts.js'
import { applyManagedSettings } from '../footprint/settings.js'
import { loadProjectContent } from '../generation/content.js'
import { composeDoctrine } from '../generation/doctrine.js'
import { materializeRuntime } from '../generation/runtime.js'
import { composeSkills, knownContentNames } from '../generation/skills/index.js'
import type { GeneratedFile, GenerationContext } from '../generation/types.js'
import { writeGeneratedFiles } from '../generation/write.js'
import { MANIFEST_PATH, readManifest, writeManifest } from './manifest.js'

/**
 * Sync: the non-interactive regeneration the prepare script runs forever
 * after adoption. It regenerates, never scaffolds, and never touches
 * committed content. It is idempotent — regenerate every generated file,
 * delete the ones the configuration stopped generating, keep the managed
 * gitignore block and settings keys true. It fails loud: broken inputs are
 * reported completely, and the degraded mode (the caller's job, see
 * degrade()) removes every generated file except the repair kit.
 */
export class SyncInputError extends Error {
  constructor(readonly issues: string[]) {
    super(`sync cannot run:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
    this.name = 'SyncInputError'
  }
}

export interface SyncResult {
  generated: string[]
  config: SeasonedSkillsConfig
}

export interface SyncOptions {
  /** Overrides the machine corpus cache — tests point this at nothing. */
  corpusCache?: string
}

export async function sync(
  projectRoot: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const config = await loadConfig(projectRoot)
  const content = loadProjectContent(projectRoot, config.contentDir)
  const known = new Set(knownContentNames(config))
  const unrecognized = [...content.files.keys()].filter((name) => !known.has(name))
  if (unrecognized.length > 0) {
    throw new SyncInputError(
      unrecognized.map(
        (name) =>
          `unrecognized content file: ${config.contentDir}/${name}.md — nothing loads it. Rename it to the skill it belongs to, or move it into a subdirectory.`,
      ),
    )
  }

  const context: GenerationContext = { config, content }
  const files: GeneratedFile[] = [
    composeDoctrine(context),
    ...composeSkills(context),
    ...materializeRuntime(),
    // The shaping references weave from whatever the machine's cache holds;
    // an absent cache generates no references, and doctor reports it.
    ...materializeCorpus(options.corpusCache ?? corpusCacheRoot()),
  ]
  const paths = files.map((file) => file.path)

  deleteStalePaths(projectRoot, readManifest(projectRoot), paths)
  writeGeneratedFiles(projectRoot, files)
  writeManifest(projectRoot, paths)
  ensureIgnored(projectRoot, ignoreEntries(paths))
  applyManagedSettings(projectRoot)
  ensureSyncScript(projectRoot)

  return { generated: paths, config }
}

/**
 * The degraded state a failed sync leaves behind: every generated file gone
 * except the package's own skill, and a minimal doctrine file carrying the
 * full error report with a standing order to repair before working.
 */
export function degrade(projectRoot: string, error: Error): void {
  const previous = readManifest(projectRoot)
  const kept = previous.filter((path) =>
    path.startsWith('.claude/skills/seasoned-skills/'),
  )
  deleteStalePaths(projectRoot, previous, kept)
  writeGeneratedFiles(projectRoot, [degradedDoctrine(projectRoot, error)])
  writeManifest(projectRoot, ['CLAUDE.md', ...kept])
}

function degradedDoctrine(projectRoot: string, error: Error): GeneratedFile {
  const contents = [
    `# ${basename(projectRoot)}`,
    '',
    '**The seasoned-skills workflow could not be generated.** This project runs on the',
    'seasoned-skills package, and its sync failed; every generated file has been removed',
    'so nothing stale can be mistaken for current doctrine. Only this file and the',
    '`seasoned-skills` skill remain.',
    '',
    '**Standing order: repair the workflow before doing any other work**, and tell the',
    'user about this state in your first reply. The `seasoned-skills` skill carries the',
    'repair steps; fix the inputs named below and run `seasoned-skills sync` again.',
    '',
    '## Error report',
    '',
    '```',
    error.message,
    '```',
    '',
  ].join('\n')
  return { path: 'CLAUDE.md', contents }
}

function deleteStalePaths(
  projectRoot: string,
  previous: string[],
  current: string[],
): void {
  const keep = new Set(current)
  for (const path of previous) {
    if (keep.has(path)) continue
    if (!isManagedPath(path)) continue
    rmSync(join(projectRoot, path), { force: true })
    pruneEmptyParents(projectRoot, path)
  }
}

/** A deleted file's directory chain is removed too, once nothing is left in it. */
function pruneEmptyParents(projectRoot: string, path: string): void {
  for (let dir = dirname(path); dir !== '.' && dir !== '/'; dir = dirname(dir)) {
    try {
      rmdirSync(join(projectRoot, dir))
    } catch {
      return // Not empty (or already gone) — stop climbing.
    }
  }
}

/** Only paths a sync could have generated are ever deleted. */
function isManagedPath(path: string): boolean {
  if (path.includes('..')) return false
  return (
    path === 'CLAUDE.md' ||
    path.startsWith('.claude/') ||
    path.startsWith('shaping/assets/') ||
    path === 'requests-from-meetings/assets/style.css'
  )
}

/**
 * The entries the managed block carries beyond the generated paths: the
 * per-user meeting configuration and the finished demo video every assembly
 * copies beside its screenplay. Neither is generated, and the generated skills
 * promise both are kept out of the project's history — so the ignore manager
 * is what has to keep that promise true.
 */
const PROMISED_ENTRIES = [
  '/demo-videos/*/*.mp4',
  'requests-from-meetings/config.local.json',
]

/** Compact gitignore entries: whole generated skill folders, single files otherwise. */
export function ignoreEntries(paths: string[]): string[] {
  const entries = new Set<string>([MANIFEST_PATH, ...PROMISED_ENTRIES])
  for (const path of paths) {
    const skillMatch = path.match(/^(\.claude\/skills\/[^/]+)\//)
    if (skillMatch?.[1]) {
      entries.add(`${skillMatch[1]}/`)
      continue
    }
    if (path.startsWith('shaping/assets/')) {
      entries.add('shaping/assets/')
      continue
    }
    entries.add(path)
  }
  return [...entries].sort()
}
