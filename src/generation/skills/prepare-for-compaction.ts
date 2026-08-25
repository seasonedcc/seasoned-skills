import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

export function composePrepareForCompaction(context: GenerationContext): GeneratedFile {
  return composeSkill('prepare-for-compaction', context)
}
