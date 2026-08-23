import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeTypeSafety(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('type-safety', context, {
      reservedSections: [{ title: 'Key types', token: 'key-types', required: true }],
    }),
  ]
}
