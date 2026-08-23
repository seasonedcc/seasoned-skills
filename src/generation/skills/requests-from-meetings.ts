import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The meeting-requests practice: the committed data folder is the project's,
 * the verifier and stylesheet are generated machinery, and the only project
 * facts the generic body needs are the fast gate commands its shipping
 * section names.
 */
export function composeRequestsFromMeetings(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('requests-from-meetings', context, {
      tokens: { 'fast-gates': fastGates(context) },
    }),
  ]
}

function fastGates(context: GenerationContext): string {
  const gates = [
    context.config.gates.lint,
    context.config.gates.typecheck,
    context.config.gates.unit,
  ].filter((gate): gate is string => gate !== undefined)
  if (gates.length === 0) return "the project's fast gates"
  return gates.map((gate) => `\`${gate}\``).join(', ')
}
