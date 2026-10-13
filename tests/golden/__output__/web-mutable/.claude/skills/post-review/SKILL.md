---
name: post-review
description: Post a completed code review on a teammate's GitHub PR as inline comments anchored to the diff, with the verdict and blocking rationale in the review summary. Use when posting review findings to GitHub, requesting changes or approving a PR, or after analyzing a PR (the pr-review skill covers the analysis) when the findings should land on the PR itself.
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

- `event` is `APPROVE` or `REQUEST_CHANGES` — the review's verdict, posted when the user asks; never approve or request changes on your own initiative. Never post a `COMMENT` review: a review that neither approves nor requests changes is the hedge the `pr-review` skill's verdict rule forbids, and it leaves the author asking whether the branch may merge.
- GitHub refuses both events on a pull request opened by the account `gh` is signed in as. A review of our own PR is never posted: its findings are ours to fix through the `review-fixes` skill, and its verdict stays in the conversation — never downgraded to a `COMMENT` review to get it onto the PR.
- `line` is a line number in the file as shown in the diff (`side: "RIGHT"` for the new version, `"LEFT"` for deleted lines). It must fall inside a diff hunk — context lines count. Compute it from the hunk headers in `gh pr diff`; an off-hunk line rejects the whole review.
- Build the payload in a file and pass `--input` — inline `-f` flags cannot express the comments array.
- When follow-up PRs will implement the findings, say so in the review body — the author must learn it in the same read as the findings. Each inline comment's "unblock" path reads as a work request, and the PRs only land minutes to hours later; an author who reads the review in that window starts implementing fixes you are about to hand them.

## Structuring the findings

- Mark each blocking comment **Blocking** and state what unblocks it. When the finding is an undocumented behavior change, the unblock path includes "if intentional, document it in the PR description" — the author decides intent, the review only demands the decision be visible.
- Label everything else explicitly as non-blocking so the author can triage at a glance.
- Each inline comment carries the finding's severity next to its Blocking or non-blocking marker (**Blocking, high.**, **Non-blocking, medium.**), so the author triages on the same scale the review used — non-blocking is the label only for a real finding banked outside the PR's governing contracts — and names what the fix can break next to the harm of shipping without it.
- A known-and-accepted item — one the project's decision record already rules on — is labeled **Known and accepted.**, quotes the ruling, and never blocks.
- A finding about a file the diff never touched anchors on the diff line that caused it — the author sees the code change and the record it invalidated in one place — and falls back to the body only when no such line exists.
- The summary opens with what is good and what was verified before listing why the review blocks. Credit claims you checked and found true — a review that only lists faults reads as unverified suspicion.
- The review was delivered under the `pr-review` skill's medium-and-up bar, so nothing below medium reaches an inline comment or the body. The summary states the bar once, in one sentence ("findings below medium were not listed"), never enumerating what fell under it: a teammate reading a short review from outside needs to know it is a filtered list, not a shallow read.
- Verify before asserting: check the PR's claims against the base branch (call sites, conventions, test counts) and anchor each finding to evidence. A finding you could not verify is phrased as a question, not a defect.
- A dead-code or unused claim stands only on a complete enumeration of possible consumers — every name the module registers, every template and call site — never on a sampled read. A deadness claim built from a truncated listing once shipped a review comment that, applied, would have broken every page rendering the template.
- When any claim in a submitted review is disproven — by the author, by later verification, or by your own follow-up work — post a correction reply on that claim's own thread as soon as you know, stating exactly what was wrong and what holds instead. Never build follow-up work on the corrected premise before the retraction is up.

## Implementing the suggestions

Unless the review was an `APPROVE`, submitting it is not the end of the job: follow up immediately with PRs that implement every blocking finding, targeted at the reviewed PR. Findings banked outside the PR's governing contracts never become a PR onto the reviewed branch: they take the out-of-scope disposition the `orchestration` skill sets, in a dedicated pass of their own.

- Base each follow-up PR on the reviewed PR's head branch (`gh pr create --base <head-branch>`), so accepting one merges into the author's branch — never into the repo's default branch.
- Split by independent context: one PR per suggestion (or cluster of suggestions) the author can accept or reject on its own. Changes that only make sense together stay in one PR — the split exists so the author can take only what they agree with, not to scatter a coherent change.
- Each PR body links the review comment(s) it implements and tells the author to feel free to simply close the PR if they don't want the change — closing is a complete resolution, with no explanation or reply owed to the reviewer.
- After opening the PRs, reply on each originating review comment thread with a link to the PR that implements it, so every thread carries its own resolution path.
- Follow-up PRs meet the same bar as any other work: the repo's own gates pass on each one.

## After the follow-ups

A review delivered through this skill is a complete task: once the review, the follow-up PRs, and the thread replies have landed, run the `self-improvement` skill over the whole effort before calling it done.

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

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/post-review.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
