import { relative } from 'node:path'
import type { SeasonedSkillsConfig } from '../../config/types.js'
import { extractSections } from '../sections.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeAgentBrowser } from './agent-browser.js'
import { composeAuthorization } from './authorization.js'
import { composeBackgroundJobs } from './background-jobs.js'
import { composeBusinessFolder } from './business-folder.js'
import { composeComposableFunctions } from './composable-functions.js'
import type { ReservedSectionSpec } from './compose.js'
import { composeDatabaseDesign } from './database-design.js'
import { composeDemoVideos } from './demo-videos.js'
import { composeDesignSystem } from './design-system.js'
import { composeEnvVars } from './env-vars.js'
import {
  composeFormattingDatetimes,
  FORMATTING_DATETIMES_SECTIONS,
} from './formatting-datetimes.js'
import { composeFrameworkFolder, FRAMEWORK_FOLDER_SECTIONS } from './framework-folder.js'
import { composeKysely } from './kysely.js'
import { composeMainSync } from './main-sync.js'
import { composeMcpServer } from './mcp-server.js'
import { composeNestedRoutes } from './nested-routes.js'
import { composeOptimisticUi } from './optimistic-ui.js'
import { composeOrchestration } from './orchestration.js'
import { composePostReview } from './post-review.js'
import { composePrReview } from './pr-review.js'
import { composePrepareForCompaction } from './prepare-for-compaction.js'
import { composeQuick } from './quick.js'
import { composeReground } from './reground.js'
import { composeRelease } from './release.js'
import { composeRequestsFromMeetings } from './requests-from-meetings.js'
import { composeReviewFixes } from './review-fixes.js'
import { composeSeasonedSkills } from './seasoned-skills.js'
import { composeSelfImprovement } from './self-improvement.js'
import { composeShaping } from './shaping.js'
import { composeSkillManagement } from './skill-management.js'
import { composeSubagents } from './subagents.js'
import { composeTesting } from './testing.js'
import { composeTypeSafety, TYPE_SAFETY_SECTIONS } from './type-safety.js'
import { composeWorktrees } from './worktrees.js'

interface RosterEntry {
  name: string
  enabled: (config: SeasonedSkillsConfig) => boolean
  compose: (context: GenerationContext) => GeneratedFile[]
  /** The structured slots this skill's content file fills, if it has any. */
  reservedSections?: ReservedSectionSpec[]
}

const always = () => true
const web = (config: SeasonedSkillsConfig) => config.webSurface !== undefined
const stack = (config: SeasonedSkillsConfig) => config.stack !== undefined

/**
 * The practice-skill roster: every composer whose skill the configuration
 * enables contributes a generated SKILL.md, plus any reference files the
 * skill ships beside it. The core tier ships to every project; the browser
 * pair binds only where a web surface exists; the stack layer materializes
 * only when the project declares its stack.
 */
const ROSTER: RosterEntry[] = [
  {
    name: 'skill-management',
    enabled: always,
    compose: (context) => [composeSkillManagement(context)],
  },
  { name: 'orchestration', enabled: always, compose: composeOrchestration },
  { name: 'subagents', enabled: always, compose: composeSubagents },
  { name: 'worktrees', enabled: always, compose: composeWorktrees },
  {
    name: 'prepare-for-compaction',
    enabled: always,
    compose: composePrepareForCompaction,
  },
  { name: 'reground', enabled: always, compose: composeReground },
  { name: 'testing', enabled: always, compose: composeTesting },
  { name: 'self-improvement', enabled: always, compose: composeSelfImprovement },
  { name: 'quick', enabled: always, compose: composeQuick },
  { name: 'pr-review', enabled: always, compose: composePrReview },
  { name: 'post-review', enabled: always, compose: composePostReview },
  { name: 'review-fixes', enabled: always, compose: composeReviewFixes },
  { name: 'main-sync', enabled: always, compose: composeMainSync },
  { name: 'release', enabled: always, compose: composeRelease },
  {
    name: 'requests-from-meetings',
    enabled: always,
    compose: composeRequestsFromMeetings,
  },
  { name: 'shaping', enabled: always, compose: composeShaping },
  { name: 'demo-videos', enabled: always, compose: composeDemoVideos },
  { name: 'design-system', enabled: web, compose: composeDesignSystem },
  { name: 'agent-browser', enabled: web, compose: composeAgentBrowser },
  { name: 'authorization', enabled: stack, compose: composeAuthorization },
  { name: 'background-jobs', enabled: stack, compose: composeBackgroundJobs },
  { name: 'business-folder', enabled: stack, compose: composeBusinessFolder },
  {
    name: 'composable-functions',
    enabled: stack,
    compose: composeComposableFunctions,
  },
  {
    name: 'type-safety',
    enabled: stack,
    compose: composeTypeSafety,
    reservedSections: TYPE_SAFETY_SECTIONS,
  },
  { name: 'database-design', enabled: stack, compose: composeDatabaseDesign },
  { name: 'kysely', enabled: stack, compose: composeKysely },
  {
    name: 'framework-folder',
    enabled: stack,
    compose: composeFrameworkFolder,
    reservedSections: FRAMEWORK_FOLDER_SECTIONS,
  },
  { name: 'env-vars', enabled: stack, compose: composeEnvVars },
  { name: 'nested-routes', enabled: stack, compose: composeNestedRoutes },
  {
    name: 'formatting-datetimes',
    enabled: stack,
    compose: composeFormattingDatetimes,
    reservedSections: FORMATTING_DATETIMES_SECTIONS,
  },
  { name: 'optimistic-ui', enabled: stack, compose: composeOptimisticUi },
  {
    name: 'mcp-server',
    enabled: (config) =>
      config.stack !== undefined && config.machineSurface !== undefined,
    compose: composeMcpServer,
  },
  {
    name: 'seasoned-skills',
    enabled: always,
    compose: (context) => [composeSeasonedSkills(context)],
  },
]

export function composeSkills(context: GenerationContext): GeneratedFile[] {
  return ROSTER.filter((entry) => entry.enabled(context.config)).flatMap((entry) =>
    entry.compose(context),
  )
}

/**
 * The register file every option-gated declaration defaults to, named where
 * both the install interview and the content guard can read it. The names stay
 * known content whether the option is on or off, so switching an option off
 * never fails a sync over the committed file it leaves behind; a project that
 * pointed its option somewhere else is covered by the configured paths.
 */
export const REGISTER_CONTENT_NAMES = {
  coverageRegister: 'coverage-register',
  excusedSurfaces: 'excused-surfaces',
  seedManifest: 'seed-manifest',
  parityStandard: 'parity-standard',
  exceptionRegister: 'exception-register',
} as const

/**
 * Every name the content directory's top level may carry: the content file of
 * every skill the package can generate — enabled or not, so turning an option
 * off never fails a sync over the file it leaves behind — plus the doctrine
 * layer, the default registers, and every file the configuration itself points
 * into the directory. Anything else there is prose nothing would ever load.
 */
export function knownContentNames(config: SeasonedSkillsConfig): string[] {
  return [
    'doctrine',
    ...ROSTER.map((entry) => entry.name),
    ...Object.values(REGISTER_CONTENT_NAMES),
    ...configuredContentNames(config),
  ]
}

/**
 * Every content file that exists but lacks a section its skill requires. An
 * absent content file is no issue at all — the project has nothing to add
 * there — so only a file the project wrote is ever held to the declaration.
 */
export function requiredSectionIssues(context: GenerationContext): string[] {
  const issues: string[] = []
  for (const entry of ROSTER) {
    const { reservedSections } = entry
    if (reservedSections === undefined || !entry.enabled(context.config)) continue
    const content = context.content.files.get(entry.name)
    if (content === undefined) continue
    const { reserved } = extractSections(
      content.body,
      reservedSections.map((section) => section.title),
    )
    for (const section of reservedSections) {
      if (!section.required || reserved.get(section.title)) continue
      issues.push(
        `content file ${context.config.contentDir}/${entry.name}.md is missing its required "${section.title}" section`,
      )
    }
  }
  return issues
}

/** Names the configuration itself points at the content directory's top level. */
function configuredContentNames(config: SeasonedSkillsConfig): string[] {
  return configuredPaths(config).flatMap((path) => {
    const name = relative(config.contentDir, path)
    if (name.includes('/') || !name.endsWith('.md')) return []
    return [name.slice(0, -'.md'.length)]
  })
}

function configuredPaths(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(configuredPaths)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(configuredPaths)
  }
  return []
}
