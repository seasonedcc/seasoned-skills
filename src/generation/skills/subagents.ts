import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeSubagents(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('subagents', context, {
      tokens: { 'calibration-file': context.config.calibrationFile },
    }),
  ]
}
