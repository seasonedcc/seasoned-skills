import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeNestedRoutes(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('nested-routes', context)]
}
