import type { SeasonedSkillsConfig } from './types.js'

/**
 * Identity helper so a project's `seasoned-skills.config.ts` gets full type
 * checking and completion with a single import.
 */
export function defineConfig(config: SeasonedSkillsConfig): SeasonedSkillsConfig {
  return config
}
