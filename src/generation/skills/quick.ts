import { renderQuickDefinitionOfDone } from '../dod.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeQuick(context: GenerationContext): GeneratedFile[] {
  const projectDisqualifiers = (context.config.quickDisqualifiers ?? [])
    .map((disqualifier) => `\n- ${disqualifier}`)
    .join('')
  return [
    composeSkill('quick', context, {
      tokens: {
        'quick-dod': renderQuickDefinitionOfDone(context),
        'project-disqualifiers': projectDisqualifiers,
      },
    }),
  ]
}
