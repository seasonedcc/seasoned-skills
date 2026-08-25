import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeReground(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('reground', context)]
}
