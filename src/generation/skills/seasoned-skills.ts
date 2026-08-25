import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeSeasonedSkills(context: GenerationContext): GeneratedFile {
  return composeSkill('seasoned-skills', context)
}
