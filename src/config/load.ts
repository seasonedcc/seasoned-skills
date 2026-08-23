import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createJiti } from 'jiti'
import type { SeasonedSkillsConfig } from './types.js'
import { validateConfig } from './validate.js'

export const CONFIG_FILE_NAME = 'seasoned-skills.config.ts'

export class ConfigError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(
      `Invalid ${CONFIG_FILE_NAME}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    )
    this.name = 'ConfigError'
    this.issues = issues
  }
}

/**
 * Loads and validates the project's configuration through an embedded
 * TypeScript loader, so consuming projects need no build step of their own.
 */
export async function loadConfig(projectRoot: string): Promise<SeasonedSkillsConfig> {
  const configPath = join(projectRoot, CONFIG_FILE_NAME)
  if (!existsSync(configPath)) {
    throw new ConfigError([`${CONFIG_FILE_NAME} not found at the repository root`])
  }
  const jiti = createJiti(import.meta.url)
  const loaded = await jiti.import<{ default?: unknown }>(configPath)
  const config = loaded.default
  if (config === undefined) {
    throw new ConfigError([`${CONFIG_FILE_NAME} must default-export its configuration`])
  }
  const issues = validateConfig(config)
  if (issues.length > 0) throw new ConfigError(issues)
  return config as SeasonedSkillsConfig
}
