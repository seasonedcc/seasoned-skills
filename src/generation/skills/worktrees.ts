import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The worktrees skill is fully generic: every project fact a lane needs —
 * databases, ports, services, repositories — is read at runtime from the
 * provisioning summary and the managed env block, both produced by the
 * package's own `seasoned-skills provision`, so the fragment carries no
 * generation-time tokens. Project-specific lane facts weave in through the
 * project's content file like every other skill's.
 */
export function composeWorktrees(context: GenerationContext): GeneratedFile[] {
  return [composeSkill('worktrees', context)]
}
