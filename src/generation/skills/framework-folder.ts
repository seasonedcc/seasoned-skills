import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill, type ReservedSectionSpec } from './compose.js'

export const FRAMEWORK_FOLDER_SECTIONS: ReservedSectionSpec[] = [
  { title: 'Application root', token: 'app-root', required: true },
]

export function composeFrameworkFolder(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('framework-folder', context, {
      reservedSections: FRAMEWORK_FOLDER_SECTIONS,
    }),
  ]
}
