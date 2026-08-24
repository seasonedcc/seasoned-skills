---
name: main-sync
description: Sync a long-lived feature branch with its repo's advancing main — bring main's commits into the branch under the repository's sync strategy, judge the rule-set and capability deltas, and re-run the combined Definition of Done. Use when main gains commits under a goal or review-fixes feature branch, before syncing a feature branch with origin/main, or when deciding whether a feature landed on main must be mirrored on the branch.
---

# Main sync

A long-lived feature branch decays as its repo's `main` advances: new rules bind work the branch already did, new capabilities land that the branch's own promises may cover, and evidence measured before the sync no longer describes the synced tree. A sync is not a mechanical operation — it is a scoped review of everything `main` brought in.

## How the branch syncs

This repository squash-merges pull requests, so a pushed branch syncs by merging `main` into it, and pushed commits are never rewritten — the branch's intermediate history vanishes at the squash, so merge commits cost nothing.

Whatever the mode, rebasing a branch nothing else references yet — never pushed, backing no pull request, feeding no other lane — is legitimate, and every rebase begins with the pre-rebase conflict-surface check: surface the conflict set before any history is rewritten (`git merge-tree`, or a throwaway merge in a scratch worktree), so a conflict-heavy rebase is chosen deliberately, never discovered midway.

With `main` in, work the four obligations below before the sync lands.

## 1. Rule-set delta — both directions

Three rule-set sources govern the branch, and a sync can move all of them:

- The workspace's own instructions and skills (`CLAUDE.md`, `.claude/skills/`).
- The repo's contracts: its `AGENTS.md` and the binding process docs it commits.
- The branch's own contracts: its design docs, decision records, and the rulings made during its effort.

Diff the sync range for changes to the first two, and apply every rule change in BOTH directions: branch code written before a new rule complies with it now (sweep the branch, don't grandfather it), and the code `main` brought in complies with the branch's own contracts wherever it lands on a surface the branch owns. A new convention arriving from `main` re-judges the branch's entire diff, and the branch's own additions re-judge main's incoming commits: one such audit caught seven branch-owned writes violating a convention `main` had just added, and an API operation that, per the branch's own parity rule, had to follow a web flow `main` had just moved behind a new facade.

## 2. Capability delta — parity or out of scope

Enumerate what `main` added over the sync range (`git log --no-merges`, read against the diff). For each capability, decide its scope against the branch's own promises: a branch that promises parity with a surface must either mirror the new capability or document why it is out (a browser-only interaction, analytics-internal state). These are rulings, not chores — when the branch's contracts do not settle one, present it to the user with a recommendation, and record the outcome where the branch documents its deliberate gaps.

## 3. Combined Definition of Done

After the sync, run the FULL combined-DoD matrix — the union of every gate that governs the branch and every gate that governs what `main` brought in: the repo's own gates end to end, plus the branch-specific proofs (seeds, manifests, e2e journeys, browser QA) for every surface the sync touched. A sync that only re-runs the branch's usual gates ships main's regressions under the branch's name.

## 4. Evidence refresh

Any banked evidence measured before the sync — gate numbers, audit passes, QA screenshots, prose claims in the PR body — is stale for whatever the sync touched. Re-establish what the sync invalidated, and update the PR body where the sync changed what it describes.

## The sync is a lane

The sync is a lane like any other: its result gets its own review audit — the `pr-review` loop's angles, scoped to what the sync changed — BEFORE the sync is declared landed, and the standing rules hold — merging the feature branch itself into `main` follows the project's standing merge rule.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/main-sync.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
