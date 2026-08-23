---
name: post-review
description: Post a completed code review on a teammate's GitHub PR as inline comments anchored to the diff, with the verdict and blocking rationale in the review summary. Use when posting review findings to GitHub, requesting changes or approving a PR, taking over a PR by the-founder, or after analyzing a PR (the pr-review skill covers the analysis) when the findings should land on the PR itself.
---

# Post review

A code review leaves comments on the code. Findings delivered only as a review body — or worse, only in chat — force the author to map prose back to lines themselves. Every finding that concerns a specific place in the diff becomes an inline comment on that line; the review body carries only what has no single anchor: the overall verdict, why the review blocks (or doesn't), and what was verified.

## Posting the review

`gh pr review` cannot create inline comments — use the reviews API with a JSON payload:

```bash
gh api repos/<owner>/<repo>/pulls/<number>/reviews --input review.json
```

```json
{
  "event": "REQUEST_CHANGES",
  "body": "Summary: what checks out, why this is blocked, pointer to the inline comments.",
  "comments": [
    { "path": "app/example.py", "line": 44, "side": "RIGHT", "body": "**Blocking.** ..." }
  ]
}
```

- `event` is `REQUEST_CHANGES`, `APPROVE`, or `COMMENT` — pick what the user asked for; never approve or request changes on your own initiative.
- `line` is a line number in the file as shown in the diff (`side: "RIGHT"` for the new version, `"LEFT"` for deleted lines). It must fall inside a diff hunk — context lines count. Compute it from the hunk headers in `gh pr diff`; an off-hunk line rejects the whole review.
- Build the payload in a file and pass `--input` — inline `-f` flags cannot express the comments array.
- When follow-up PRs will implement the findings, say so in the review body — the author must learn it in the same read as the findings. Each inline comment's "unblock" path reads as a work request, and the PRs only land minutes to hours later; an author who reads the review in that window starts implementing fixes you are about to hand them.

## Structuring the findings

- Mark each blocking comment **Blocking** and state what unblocks it. When the finding is an undocumented behavior change, the unblock path includes "if intentional, document it in the PR description" — the author decides intent, the review only demands the decision be visible.
- Label everything else explicitly as non-blocking so the author can triage at a glance.
- The summary opens with what is good and what was verified before listing why the review blocks. Credit claims you checked and found true — a review that only lists faults reads as unverified suspicion.
- Verify before asserting: check the PR's claims against the base branch (call sites, conventions, test counts) and anchor each finding to evidence. A finding you could not verify is phrased as a question, not a defect.
- A dead-code or unused claim stands only on a complete enumeration of possible consumers — every name the module registers, every template and call site — never on a sampled read. A deadness claim built from a truncated listing once shipped a review comment that, applied, would have broken every page rendering the template.
- When any claim in a submitted review is disproven — by the author, by later verification, or by your own follow-up work — post a correction reply on that claim's own thread as soon as you know, stating exactly what was wrong and what holds instead. Never build follow-up work on the corrected premise before the retraction is up.

## Implementing the suggestions

Unless the review was an `APPROVE`, submitting it is not the end of the job: follow up immediately with PRs that implement every suggestion the review made, targeted at the reviewed PR.

- Base each follow-up PR on the reviewed PR's head branch (`gh pr create --base <head-branch>`), so accepting one merges into the author's branch — never into the repo's default branch.
- Split by independent context: one PR per suggestion (or cluster of suggestions) the author can accept or reject on its own. Changes that only make sense together stay in one PR — the split exists so the author can take only what they agree with, not to scatter a coherent change.
- Each PR body links the review comment(s) it implements and tells the author to feel free to simply close the PR if they don't want the change — closing is a complete resolution, with no explanation or reply owed to the reviewer.
- After opening the PRs, reply on each originating review comment thread with a link to the PR that implements it, so every thread carries its own resolution path.
- Follow-up PRs meet the same bar as any other work: the repo's own gates pass on each one.

## After the follow-ups

A review delivered through this skill is a complete task: once the review, the follow-up PRs, and the thread replies have landed, run the `self-improvement` skill over the whole effort before calling it done.

## the founder's PRs: take over instead of posting a review

When the PR's author is the-founder, nothing above applies as written. the founder contributes PRs in place of feature requests and does not return to work review feedback; by agreement, the user takes his PRs over. Never post a review asking him to change anything, and never open follow-up PRs for him to accept — the resolutions land on his PR directly:

- Put every open decision to the user as a question — with a recommendation — and build only the chosen option. Batch decisions of the same shape into one question set.
- Work lands as commits on the PR's own branch: merge its base branch in (never rebase — the branch backs an open PR), fix every confirmed finding, and finish the feature to the full Definition of Done. That includes live-browser verification of any behavior the automated suites never execute — a static read of frontend code validates its APIs but not its dynamics, and the one real bug of the first takeover was exactly there.
- When the branch is merge-ready: rewrite the PR description to current truth for an external reader, preserving the founder's original spec block (it is the intent record); reply on every open thread with its resolution; resolve the threads; and dismiss any now-stale blocking review, crediting what got fixed.
- Merging the PR remains the user's act. Report it merge-ready and stop — do not ask whether to merge: the user asks for the merge, never the other way around.

## Replacing a review

To supersede an earlier review of yours, submit the new one first, then dismiss the old:

```bash
gh api -X PUT repos/<owner>/<repo>/pulls/<number>/reviews/<review-id>/dismissals \
  -f message="Superseded by the inline review below." -f event="DISMISS"
```

Find the review id with `gh api repos/<owner>/<repo>/pulls/<number>/reviews`.

## Resolving your own threads

When a concern of yours has been addressed and you approve (or supersede a blocking review with an approval), resolve every thread you opened — a reply is not a resolution, and an unresolved thread keeps blocking the merge on repos that require conversation resolution. Only GraphQL can do it:

```bash
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread-id>"}) { thread { isResolved } } }'
```

Find thread ids via the `reviewThreads` connection on the pull request. Resolve only threads whose concern you have verified as addressed — resolution is the reviewer's verdict on the thread, not cleanup.
