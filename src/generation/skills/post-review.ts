import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composePostReview(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('post-review', context)]
}
