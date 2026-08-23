import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeSkillManagement(context: GenerationContext): GeneratedFile {
  return composeSkill('skill-management', context)
}
