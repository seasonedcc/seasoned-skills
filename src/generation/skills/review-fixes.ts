import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeReviewFixes(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('review-fixes', context)]
}
