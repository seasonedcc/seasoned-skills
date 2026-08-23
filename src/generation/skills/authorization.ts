import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeAuthorization(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('authorization', context)]
}
