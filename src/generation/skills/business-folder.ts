import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeBusinessFolder(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('business-folder', context)]
}
