---
name: review-fixes
description: Turn a completed PR review's findings into an adjudicated fix scope and land the fixes on the reviewed PR's own branch — triage the certain defects, adjudicate everything else with the user one finding at a time, then orchestrate fix lanes merged into the feature branch. Use when fixing review findings on our own PR, addressing a pr-review analysis, or driving a reviewed PR toward a clean re-review.
---

# Review fixes

A review's findings only matter once they change the PR. This skill runs after a `pr-review` analysis — mainly on our own PRs — and its success criterion is singular: the next `pr-review` round of the PR comes back clean. That criterion shapes everything below, because it forbids the three easy failure modes: fixing on the user's behalf what was really theirs to rule on, shipping fixes whose own defects become the next round's findings, and fixing things that were never broken — every unnecessary change hands the next review round new material to flag.

The `post-review` skill is the counterpart for someone else's PR — posting findings as inline comments and offering follow-up PRs. This skill never posts a review; it lands resolutions.

## Phase 1 — Triage: separate the certain from the adjudicable

The fix scope is bounded by the PR's governing contracts before anything is sorted: the review delivers each finding classified as in-scope or banked, with its provenance (the `pr-review` skill establishes both), and triage honors that boundary — a banked finding stays banked no matter how certain the defect, because a PR that absorbs out-of-scope fixes feeds the next round new material and never converges. Where the review failed to deliver the classification, re-derive it from the contracts themselves — goal texts, standing rulings — never from the finding's severity, and provenance from the base's own lines, since whether the PR created a defect or merely exposes one already on the base is usually what the contracts turn on.

Then sort every in-scope finding — confirmed, plausible, and the notes — into two piles:

- **Certain defects.** Findings that are unambiguously wrong and have exactly one defensible resolution: crashes, regressions against previous behavior, code that contradicts its own documentation's plain intent, convention violations with a quoted rule. The test for certainty: the reasoning closes the question — every alternative resolution has been examined and eliminated on the merits, so anyone reasoning from the same evidence lands on the same fix. Certainty is a property of the argument, never a prediction of what the user would say: what is right is owned by neither side, and it is reached by reasoning. These enter the fix scope directly — the user never adjudicates them.
- **Adjudicable findings.** The findings where reasoning alone cannot close the question: genuine trade-offs with more than one defensible resolution, behavior that is deliberate and test-pinned but questionable, doc-versus-code contradictions where either side could be the intended truth, product intent only the user holds, disclosure decisions, anything whose fix would reverse a choice the author visibly made. When in doubt, the finding is adjudicable — doubt is itself evidence the argument does not close.

Present the triage in conversation before proceeding: the certain list with a one-line fix direction per item (so the user can veto in passing — presenting is not asking), and the adjudicable list as the queue for Phase 2.

## Phase 2 — Adjudicate the rest with the user, one finding at a time

Before a finding enters the queue, test it against the PR's governing contracts and the rulings already made: a finding whose every resolution the contracts foreclose is not adjudicable — resolve it by the contract and record which contract ruled it — and every ruling is a precedent that resolves later findings of the same shape without another question. A contract-answered finding left in the queue spends the user's attention on a decision already made.

Work the adjudicable queue in severity order, strictly one finding per message. For each:

1. **Groundwork first.** Before presenting anything, re-establish the finding against the source and trace each candidate resolution to its consequences: the tests that pin the current behavior, the docs and PR-body claims that promise it, the callers and integrations that depend on it, what each option costs to build and to live with. Question every assumption, including the finding's own: is the problem it describes real? If the code being flagged came from an earlier fix round, ask whether that fix was needed at all — check its reasons against how the system around it actually works, and against how long the code will live. When a finding says behavior changed, ask who can trigger the change: if no browser or client can ever send that input, users see nothing different, and there is nothing to fix. A recommendation that dissolves under the user's first question was not ready to present.
2. **Present, then ask.** Lay out the finding in conversation — the user-visible behavior and stakes before the mechanism — then the defensible options with their consequences, then a single grounded recommendation with its reason. The user adjudicates in normal conversation; move to the next finding only when the current one is ruled.
3. **Record every ruling** in the effort's ledger, verbatim enough to survive compaction: the finding, the ruling, and the reasoning the user gave. Record only rulings the user actually gave — never one you inferred or expected them to give.

A ruling of "leave it as is" still usually produces work: behavior accepted as deliberate gets documented — in the PR body, the reference docs, or both — so the next review round confirms it as a stated trade instead of re-flagging it. A finding with no code change and no documentation change is only fully resolved when the next round would refute it unaided.

Fix lanes for certain defects may launch while adjudication proceeds, but only lanes no pending ruling could plausibly reshape — a fix that shares a module, a contract, or a design decision with an adjudicable finding waits for the ruling. Adjudication stays the foreground activity throughout.

## Phase 3 — Design each fix before chartering it

Fix design is orchestrator-tier work and happens before any lane launches. For each in-scope finding, decide the shape of the fix personally, then interrogate it the way the next review round will — the finders run the same angles every time:

- **Altitude**: does the fix generalize the mechanism, or patch one symptom of it? A special case layered on shared infrastructure is next round's altitude finding.
- **Parity**: on a surface with a sibling (REST and MCP, web and API), does the fix land on both sides, or does it open the parity gap the review just praised?
- **Removed behavior**: what invariant does the fix's diff delete or weaken, and where is it re-established?
- **Description accuracy**: which PR-body claims does the fix invalidate? Every fix that changes behavior the body describes carries naming those claims — quoted — in its scope; the edit itself belongs to the artifact's single writer, per Phase 4.
- **Pinned tests**: which tests pin the behavior being changed? They get rewritten to pin the new behavior — a green suite that still asserts the old contract is a next-round finding, and so is a deleted test with no successor.
- **Conventions and Definition of Done**: the fix meets the touched repo's full bar — gates, seeds and manifests for changed surfaces, no leftover comments.

A fix that cannot pass this interrogation gets redesigned now, not after a lane builds it.

A ruling authorizes a direction, not an unseen design. When the ruled resolution still leaves the mechanism open — more than one way to build it, or trade-offs of its own, such as a new trust boundary, a maintained external list, or a changed key — present the designed solution and its trade-offs in conversation and build only on the user's go. The interrogation above prepares that presentation; it does not replace it.

## Phase 4 — Execute like a goal

Execution follows the workspace's `/goal` shape — the orchestration, subagents, and worktrees skills govern the machinery:

- All work lands on the reviewed PR's head branch (the feature branch), never on the default branch.
- Group the scope into lanes: independent findings run in parallel worktrees; findings that touch the same module or the same contract share one lane. Each lane's charter carries the finding, the adjudicated ruling where one exists, and the designed fix shape — never just the finding text.
- Shared prose artifacts each have exactly one writer, named in every charter. The PR body is the orchestrator's alone — rewritten once, after the last lane merges — and a reference doc several findings touch gets one owning lane per wave; every other lane reports the claims its change invalidates, quoted, instead of editing. A charter that only asks lanes to report invalidated claims without naming the owner splits the lanes both ways — some edit, some report — and the drift surfaces as stale-claim residue a dedicated sweep has to find.
- Lane PRs target the feature branch. Personally review each lane PR's diff, and merge it into the feature branch only when satisfied — the standing rule applies: never merge broken work, and merging the feature branch itself into the default branch follows the project's standing merge rule.
- After the last lane merges: rewrite the PR body to the branch's current truth, folding in the disclosures and deliberate-behavior documentation the rulings produced, and run the branch's full gates end to end.

## Exit

Report the outcome as a findings-to-resolutions map: each finding, its ruling (fixed, documented as deliberate, or explicitly declined by the user), and where the resolution landed. Then propose a fresh `pr-review` round of the PR as it now stands — a full-rigor re-review, per that skill's re-review rules — since a clean round is this skill's definition of done. Running it is the user's call.
