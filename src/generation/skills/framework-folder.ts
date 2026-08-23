import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeFrameworkFolder(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('framework-folder', context, {
      reservedSections: [
        { title: 'Application root', token: 'app-root', required: true },
      ],
    }),
  ]
}
