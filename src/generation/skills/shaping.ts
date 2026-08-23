import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The shaping skill has nothing to merge — its single source is the text
 * this package carries. Standing project principles weave in through the
 * regular project-content mechanism, and the references corpus beside the
 * generated skill is materialized by sync from the machine's cache, not
 * composed here.
 */
export function composeShaping(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('shaping', context)]
}
