import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeSelfImprovement(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('self-improvement', context, {
      tokens: {
        'content-dir': context.config.contentDir,
        'calibration-file': context.config.calibrationFile,
      },
    }),
  ]
}
