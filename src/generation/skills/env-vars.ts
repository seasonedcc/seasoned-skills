import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeEnvVars(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('env-vars', context)]
}
