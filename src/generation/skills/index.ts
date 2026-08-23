import type { SeasonedSkillsConfig } from '../../config/types.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkillManagement } from './skill-management.js'

interface RosterEntry {
  name: string
  enabled: (config: SeasonedSkillsConfig) => boolean
  compose: (context: GenerationContext) => GeneratedFile
}

/**
 * The practice-skill roster: every composer whose skill the configuration
 * enables contributes one generated SKILL.md. Unconditional skills ship to
 * every project; conditional ones join based on the configured surfaces.
 */
const ROSTER: RosterEntry[] = [
  { name: 'skill-management', enabled: () => true, compose: composeSkillManagement },
]

export function composeSkills(context: GenerationContext): GeneratedFile[] {
  return ROSTER.filter((entry) => entry.enabled(context.config)).map((entry) =>
    entry.compose(context),
  )
}

/** The content files generation requires, given the configuration. */
export function requiredContentNames(config: SeasonedSkillsConfig): string[] {
  return [
    'doctrine',
    ...ROSTER.filter((entry) => entry.enabled(config)).map((e) => e.name),
  ]
}
