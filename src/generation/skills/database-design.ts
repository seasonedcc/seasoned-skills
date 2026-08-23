import { fragment } from '../fragments.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The database-design skill ships the shared core unconditionally — identity
 * versus event tables, no nullable columns, no derivable columns, the
 * state-derivation patterns, the lock discipline and commit-order rule for
 * absolute-set events, the performance ladder. The configured mutability
 * stance decides only which write-discipline clauses weave on top.
 */
export function composeDatabaseDesign(context: GenerationContext): GeneratedFile[] {
  const stack = context.config.stack
  if (!stack) throw new Error('database-design requires the stack layer')
  return [
    composeSkill('database-design', context, {
      tokens: {
        'mutability-stance': fragment(
          `skills/database-design/${stack.databaseMutability}.md`,
        ),
      },
    }),
  ]
}
