import { fragment } from '../fragments.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The sync strategy follows from the merge strategy: a merge-commit repository
 * keeps branch history linear by rebasing pushed branches under the rewrite
 * discipline, a squash repository merges the base in and never rewrites pushed
 * commits. The mode fragment fills the skill's how-the-branch-syncs section;
 * everything else — including the rebase-unreferenced-branches allowance and
 * the pre-rebase conflict-surface check — is shared by both modes.
 */
export function composeMainSync(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('main-sync', context, {
      tokens: {
        'sync-mechanics': fragment(
          `skills/main-sync/sync-${context.config.mergeStrategy}.md`,
        ),
      },
    }),
  ]
}
