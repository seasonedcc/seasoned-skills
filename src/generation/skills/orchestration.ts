import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * How a pushed lane branch syncs and lands follows from the merge strategy —
 * one setting, because the sync strategy follows from the merge strategy. Each
 * mode weaves in only its own pushed-branch discipline; rebasing a branch
 * nothing else references yet is legitimate in both modes, so that discipline
 * lives in the shared fragment text.
 */
const PUSHED_BRANCH_DISCIPLINE: Record<'merge-commit' | 'squash', string> = {
  'merge-commit':
    "- Merge a PR with a merge commit (`gh pr merge --merge`) — never squash or rebase-merge — and sync a pushed lane with its base by rebase, keeping branch history linear. Rewriting pushed history is safe only under its discipline: the patch-identity check after every rebase, and a post-rebase reconciliation of the lane's claims against the new base.",
  squash:
    "- Merge a PR by squash (`gh pr merge --squash`). A branch that backs an open PR — a lane under review, a shared feature branch — syncs by merging its base in, never by rebase or force-push. Rebase is for branches nothing else references yet.\n- A lane's pushed commits are never rewritten — a fix pass lands as a follow-up commit, not `--amend` + force-push, even before any PR exists. Rewriting another agent's pushed commit trips the harness's security review, and the resulting permission blocks can stall the pipeline at PR creation until the user intervenes; a tidy single-commit history buys nothing the squash-merge doesn't.",
}

/**
 * What happens to a confirmed out-of-scope finding: banked for adjudication
 * with the user (the conservative default), or fixed autonomously under the
 * codified Definition of Broken when the project opts in. In both modes the
 * fix runs in its own dedicated pass — that part is fragment text.
 */
const FINDINGS_DISPOSITION: Record<'bank' | 'autofix', string> = {
  bank: 'The disposition here is conservative: bank the finding with its evidence and adjudicate it with the user.',
  autofix:
    'The disposition is fix-now by default, under the codified Definition of Broken — a failing gate, a reproducible runtime failure, a violation of written doctrine; never a judgment call. A finding that needs a genuine user ruling is banked for adjudication instead.',
}

export function composeOrchestration(context: GenerationContext): GeneratedFile[] {
  return [
    composeSkill('orchestration', context, {
      tokens: {
        'pushed-branch-discipline':
          PUSHED_BRANCH_DISCIPLINE[context.config.mergeStrategy],
        'findings-disposition':
          FINDINGS_DISPOSITION[context.config.outOfScopeFindings ?? 'bank'],
      },
    }),
  ]
}
