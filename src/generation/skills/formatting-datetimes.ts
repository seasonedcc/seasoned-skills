import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill, type ReservedSectionSpec } from './compose.js'

/**
 * The project's time-zone model — tenant-configurable or a constant — is the
 * one project fact the generic text weaves at its own anchor, so a content
 * file for this skill must declare it as a reserved section.
 */
export const FORMATTING_DATETIMES_SECTIONS: ReservedSectionSpec[] = [
  { title: 'Time-zone model', token: 'time-zone-model', required: true },
]

export function composeFormattingDatetimes(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('formatting-datetimes', context, {
      reservedSections: FORMATTING_DATETIMES_SECTIONS,
    }),
  ]
}
