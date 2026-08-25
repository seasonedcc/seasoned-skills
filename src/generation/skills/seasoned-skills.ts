import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The package's own skill: how to install, configure, upgrade, and repair the
 * workflow. It is the repair kit a degraded project keeps, so sync must be
 * able to regenerate it in the exact situation where the content directory is
 * the failure being reported.
 */
export function composeSeasonedSkills(context: GenerationContext): GeneratedFile {
  return composeSkill('seasoned-skills', context)
}
