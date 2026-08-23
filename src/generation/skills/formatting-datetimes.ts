import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The project's time-zone model — tenant-configurable or a constant — is the
 * one project fact the generic text weaves at its own anchor, so the content
 * file must declare it as a reserved section.
 */
export function composeFormattingDatetimes(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('formatting-datetimes', context, {
      reservedSections: [
        { title: 'Time-zone model', token: 'time-zone-model', required: true },
      ],
    }),
  ]
}
