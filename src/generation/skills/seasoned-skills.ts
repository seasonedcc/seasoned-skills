import type { ContentFile, GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The package's own skill: how to install, configure, upgrade, and repair the
 * workflow. It is the repair kit a degraded project keeps, so unlike every
 * other generated skill it composes even when its content file is absent —
 * sync must be able to regenerate it in the exact situation where content
 * files are the problem.
 */
export function composeSeasonedSkills(context: GenerationContext): GeneratedFile[] {
  if (context.content.files.has('seasoned-skills')) {
    return [composeSkill('seasoned-skills', context)]
  }
  const files = new Map<string, ContentFile>(context.content.files)
  files.set('seasoned-skills', { body: '' })
  return [composeSkill('seasoned-skills', { ...context, content: { files } })]
}
