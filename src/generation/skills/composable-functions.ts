import { fragment } from '../fragments.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composeComposableFunctions(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('composable-functions', context),
    {
      path: '.claude/skills/composable-functions/references/complete-docs.md',
      contents: `${fragment('skills/composable-functions/references/complete-docs.md')}\n`,
    },
  ]
}
