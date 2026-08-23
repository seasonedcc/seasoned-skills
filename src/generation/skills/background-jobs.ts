import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The background-jobs skill is stance-aware in one clause: job handlers write
 * to the application schema, so the write discipline they follow is decided by
 * `config.stack.databaseMutability` — the stack layer's deepest option — and
 * woven into the `{{write-discipline}}` token. Everything else in the fragment
 * is stance-neutral shared core.
 */
export function composeBackgroundJobs(context: GenerationContext): GeneratedFile[] {
  const stack = context.config.stack
  if (!stack) {
    throw new Error('background-jobs is a stack-layer skill; config.stack is required')
  }
  const writeDiscipline =
    stack.databaseMutability === 'append-only'
      ? 'the append-only doctrine: INSERT-only, status derived from event rows'
      : "the project's database write discipline: no derivable columns, with in-place updates and explicit transactional deletes staying legitimate where the data is not derivable"
  return [
    composeSkill('background-jobs', context, {
      tokens: { 'write-discipline': writeDiscipline },
    }),
  ]
}
