import { fragment } from '../fragments.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The browser skill carries the lane-side hygiene discipline — one session for
 * the whole run, named after the lane, closed before reporting — alongside the
 * automation doctrine; the orchestrator-side sweep discipline lives in the
 * orchestration skill. Two static references ship beside the SKILL.md: the
 * full CLI surface and the authentication patterns, every state-file example
 * pointing at an absolute path in the scratchpad directory.
 */
export function composeAgentBrowser(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('agent-browser', context),
    referenceFile('authentication.md'),
    referenceFile('cli-reference.md'),
  ]
}

function referenceFile(name: string): GeneratedFile {
  return {
    path: `.claude/skills/agent-browser/references/${name}`,
    contents: `${fragment(`skills/agent-browser/references/${name}`)}\n`,
  }
}
