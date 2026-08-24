---
name: quick
description: Run a small fix or polish to an existing surface under a reduced quick-iteration Definition of Done — no subagents, no self-improvement pass. Use ONLY when the user explicitly invokes /quick; never select this mode on your own, never suggest it, and never let it self-trigger.
---

# Quick

A small fix should cost minutes, not half an hour. This mode trades the full Definition of Done for a reduced one that still protects correctness: the gates that catch real breakage stay, the rituals that only pay off on large or risky changes go.

## Explicit only

This mode applies when — and only when — the user invoked `/quick`. Never classify a task as quick yourself, and never offer quick mode as an option: the choice is the user's alone, made by typing the command.

If the work outgrows the qualification criteria mid-task, stop, tell the user what it grew into, and continue under the full Definition of Done in `CLAUDE.md`. Discovering that a "small fix" needs a migration is not a reason to press on quietly.

## Qualification criteria

Qualifies: a small fix or polish to an existing surface.

Any one of these disqualifies:

- a new route
- a new table or migration
- a new permission
- a new product surface
- a change to the posting rules or the chart of accounts
- a change to a published endpoint contract

A disqualified task runs under the full Definition of Done, even though the user invoked `/quick`. Say so before starting.

## Workflow

- Work inline: no subagents, no charters, no ledger. You are the one reading, building, and testing.
- Load only the skills the change itself needs — the one covering the surface being touched — and nothing else on spec.
- Still work in an isolated worktree. Provisioning takes well under a minute, and the isolation is what lets the change be verified against a real server without disturbing anything else. The exception is a documentation-only diff (as defined in CLAUDE.md's Definition of Done), which needs no server and follows that path's no-provisioning rule even under `/quick`.
- When continuing the same thread of work, reuse the lane already provisioned for it instead of setting up another.

## Quick Definition of Done

When the user invoked `/quick` and the task qualifies, this list replaces the one in `CLAUDE.md`. It is derived from the same composition as the full Definition of Done — every criterion there declared its quick-mode disposition, so the two lists cannot drift apart.

1. `pnpm run lint` and `pnpm run tsc` are green. Run only the unit test files the change affects — the full suites run on the PR's CI.
2. A task is not done if it has leftover comments — remove them before finishing.
3. One `pr-review` pass over the lane's draft PR, with the fixes applied. A single pass, not a loop.

Everything the full list carries beyond these items is skipped entirely: the self-improvement pass is excluded outright, and every other missing criterion is one the qualification criteria guarantee cannot apply.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/quick.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
