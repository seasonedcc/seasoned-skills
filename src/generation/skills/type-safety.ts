import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill, type ReservedSectionSpec } from './compose.js'

export const TYPE_SAFETY_SECTIONS: ReservedSectionSpec[] = [
  { title: 'Key types', token: 'key-types', required: true },
]

export function composeTypeSafety(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('type-safety', context, { reservedSections: TYPE_SAFETY_SECTIONS }),
  ]
}
