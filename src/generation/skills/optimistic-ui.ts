import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeOptimisticUi(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('optimistic-ui', context)]
}
