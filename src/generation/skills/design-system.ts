import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The design-system guide is generated in two parts: the package's fragment
 * carries the design doctrine every project shares — token discipline, the
 * typography tiers, the closed status vocabulary, flow design, the responsive
 * canon, print, motion, and the navigation shell — and the project's own
 * guidelines (its palette, its component library, its concrete idioms) weave in
 * from its content file as the project-specifics section.
 */
export function composeDesignSystem(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('design-system', context)]
}
