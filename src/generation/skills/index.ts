import type { SeasonedSkillsConfig } from '../../config/types.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeAgentBrowser } from './agent-browser.js'
import { composeAuthorization } from './authorization.js'
import { composeBackgroundJobs } from './background-jobs.js'
import { composeBusinessFolder } from './business-folder.js'
import { composeComposableFunctions } from './composable-functions.js'
import { composeDatabaseDesign } from './database-design.js'
import { composeDemoVideos } from './demo-videos.js'
import { composeDesignSystem } from './design-system.js'
import { composeEnvVars } from './env-vars.js'
import { composeFormattingDatetimes } from './formatting-datetimes.js'
import { composeFrameworkFolder } from './framework-folder.js'
import { composeKysely } from './kysely.js'
import { composeMainSync } from './main-sync.js'
import { composeMcpServer } from './mcp-server.js'
import { composeNestedRoutes } from './nested-routes.js'
import { composeOptimisticUi } from './optimistic-ui.js'
import { composeOrchestration } from './orchestration.js'
import { composePostReview } from './post-review.js'
import { composePrReview } from './pr-review.js'
import { composeQuick } from './quick.js'
import { composeRelease } from './release.js'
import { composeRequestsFromMeetings } from './requests-from-meetings.js'
import { composeReviewFixes } from './review-fixes.js'
import { composeSeasonedSkills } from './seasoned-skills.js'
import { composeSelfImprovement } from './self-improvement.js'
import { composeSkillManagement } from './skill-management.js'
import { composeSubagents } from './subagents.js'
import { composeTesting } from './testing.js'
import { composeTypeSafety } from './type-safety.js'
import { composeWorktrees } from './worktrees.js'

interface RosterEntry {
  name: string
  enabled: (config: SeasonedSkillsConfig) => boolean
  /** Set when the skill composes without a content file (the repair kit). */
  optionalContent?: boolean
  compose: (context: GenerationContext) => GeneratedFile[]
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
  { name: 'type-safety', enabled: stack, compose: composeTypeSafety },
  { name: 'database-design', enabled: stack, compose: composeDatabaseDesign },
  { name: 'kysely', enabled: stack, compose: composeKysely },
  { name: 'framework-folder', enabled: stack, compose: composeFrameworkFolder },
  { name: 'env-vars', enabled: stack, compose: composeEnvVars },
  { name: 'nested-routes', enabled: stack, compose: composeNestedRoutes },
  { name: 'formatting-datetimes', enabled: stack, compose: composeFormattingDatetimes },
  { name: 'optimistic-ui', enabled: stack, compose: composeOptimisticUi },
  {
    name: 'mcp-server',
    enabled: (config) =>
      config.stack !== undefined && config.machineSurface !== undefined,
    compose: composeMcpServer,
  },
  // The package's own skill is the repair kit a degraded project keeps: its
  // content file is optional, because sync must regenerate it even when
  // missing content files are the failure being reported.
  {
    name: 'seasoned-skills',
    enabled: always,
    optionalContent: true,
    compose: composeSeasonedSkills,
  },
]

export function composeSkills(context: GenerationContext): GeneratedFile[] {
  return ROSTER.filter((entry) => entry.enabled(context.config)).flatMap((entry) =>
    entry.compose(context),
  )
}

/** The content files generation requires, given the configuration. */
export function requiredContentNames(config: SeasonedSkillsConfig): string[] {
  return [
    'doctrine',
    ...ROSTER.filter((entry) => entry.enabled(config) && !entry.optionalContent).map(
      (e) => e.name,
    ),
  ]
}
