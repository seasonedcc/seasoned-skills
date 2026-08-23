---
name: quick
description: Run a small fix or polish to an existing surface under a reduced quick-iteration Definition of Done — no subagents, no mobile pass, no self-improvement pass. Use ONLY when the user explicitly invokes /quick; never select this mode on your own, and never suggest it.
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
- a new background job
- a new product surface
- a new capability the MCP server would have to mirror
- an architecturally material change
- anything that opens a simulator — a diff touching `apps/mobile/` or `packages/bridge/`, the `mobile-verification` skill's trigger

A disqualified task runs under the full Definition of Done, even though the user invoked `/quick`. Say so before starting.

## Workflow

- Work inline: no subagents, no charters, no ledger. You are the one reading, building, and testing.
- Load only the skills the change itself needs — `design-system` for UI work, `kysely` for a query, and nothing else on spec.
- Still work in an isolated worktree. Provisioning takes well under a minute, and the isolation is what lets the change be verified against a real server without disturbing anything else. The exception is a documentation-only diff (as defined in CLAUDE.md's Definition of Done), which needs no server and follows that path's no-provisioning rule even under `/quick`.
- When continuing the same thread of work, reuse the lane already provisioned for it instead of setting up another.

## Quick Definition of Done

When the user invoked `/quick` and the task qualifies, this list replaces the one in `CLAUDE.md`.

1. `pnpm run lint` and `pnpm run tsc` are green. Run only the unit test files the change affects — the full suites run on the PR's CI.
2. Bug fixes still follow red/green: a failing test first, then the minimal fix. No mutation proof, and no double `test:unit` reconciliation run.
3. Verify the changed flow end to end with `agent-browser` and take a screenshot.
4. If user-visible behavior changed, update the existing Playwright spec that covers the flow. Editing an existing spec does not require the retry-safety death-injection proof; a brand-new spec still follows the `testing` skill in full.
5. Mobile verification is skipped, and no diff audit is needed to justify it: a change touching `apps/mobile/` or `packages/bridge/` never qualified for quick mode in the first place.
6. One code-review pass over the lane's committed diff, with the fixes applied. A single pass, not a loop.
7. Open a PR. The CI E2E job stays the acceptance gate — fix any red on the branch.
8. Skipped entirely: the self-improvement pass, and the `architecture.md`, user-manual, MCP-parity, and dev-seed criteria. The qualification criteria guarantee none of them can apply.
