import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composePrReview(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('pr-review', context)]
}
