---
name: main-sync
description: Sync a long-lived feature branch with its repo's advancing main — merge main in, judge the rule-set and capability deltas, and re-run the combined Definition of Done. Use when main gains commits under a goal or review-fixes feature branch, before merging origin/main into a feature branch, or when deciding whether a feature landed on main must be mirrored on the branch.
---

# Main sync

A long-lived feature branch decays as its repo's `main` advances: new rules bind work the branch already did, new capabilities land that the branch's own promises may cover, and evidence measured before the sync no longer describes the merged tree. A sync is not a mechanical merge — it is a scoped review of everything `main` brought in. Merge `main` into the branch (a branch backing an open PR is public history — merge, never rebase it), then work the four obligations below before the sync lands.

## 1. Rule-set delta — both directions

Three rule-set sources govern the branch, and a sync can move all of them:

- The workspace's own instructions and skills (`CLAUDE.md`, `.claude/skills/`).
- The repo's contracts: its `AGENTS.md` and binding process docs (`docs/process/` in product-monolith).
- The branch's own contracts: its design docs, decision records, and the rulings made during its effort.

Diff the sync range for changes to the first two, and apply every rule change in BOTH directions: branch code written before a new rule complies with it now (sweep the branch, don't grandfather it), and the code `main` brought in complies with the branch's own contracts wherever it lands on a surface the branch owns. A new convention arriving from `main` re-judges the branch's entire diff, and the branch's own additions re-judge main's incoming commits: one such audit caught seven branch-owned writes violating a convention `main` had just added, and an API operation that, per the branch's own parity rule, had to follow a web flow `main` had just moved behind a new facade.

## 2. Capability delta — parity or out of scope

Enumerate what `main` added over the sync range (`git log --no-merges`, read against the diff). For each capability, decide its scope against the branch's own promises: a branch that promises parity with a surface must either mirror the new capability or document why it is out (a browser-only interaction, analytics-internal state). These are rulings, not chores — when the branch's contracts do not settle one, present it to the user with a recommendation, and record the outcome where the branch documents its deliberate gaps.

## 3. Combined Definition of Done

After the merge, run the FULL combined-DoD matrix — the union of every gate that governs the branch and every gate that governs what `main` brought in: the repo's own gates end to end, plus the branch-specific proofs (seeds, manifests, e2e journeys, browser QA) for every surface the sync touched. A sync that only re-runs the branch's usual gates ships main's regressions under the branch's name.

## 4. Evidence refresh

Any banked evidence measured before the sync — gate numbers, audit passes, QA screenshots, prose claims in the PR body — is stale for whatever the sync touched. Re-establish what the merge invalidated, and update the PR body where the sync changed what it describes.

## The sync is a lane

The sync merge is a lane like any other: it gets its own code-review audit BEFORE it merges into the feature branch, and the standing rules hold — merging the feature branch itself into `main` remains the user's act.
