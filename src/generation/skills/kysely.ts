import { fragment } from '../fragments.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The kysely skill's write-discipline block follows the configured mutability
 * stance: append-only weaves the insert-only rules, mutable-when-not-derivable
 * weaves upserts and in-place writes. Everything else ships unconditionally.
 */
export function composeKysely(context: GenerationContext): GeneratedFile[] {
  const stack = context.config.stack
  if (!stack) throw new Error('kysely requires the stack layer')
  return [
    composeSkill('kysely', context, {
      tokens: {
        'mutability-stance': fragment(`skills/kysely/${stack.databaseMutability}.md`),
      },
    }),
  ]
}
