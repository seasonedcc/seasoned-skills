import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The demo-video practice: screenplays are committed project content, the rig
 * and narrator are generated machinery under the skill's own gitignored tree,
 * and the only project facts the generic body needs are the fast gate
 * commands its shipping section names.
 */
export function composeDemoVideos(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('demo-videos', context, {
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
