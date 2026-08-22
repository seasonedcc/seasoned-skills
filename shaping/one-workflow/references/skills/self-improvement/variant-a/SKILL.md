---
name: self-improvement
description: Codify lessons from a completed task into repo improvements — skill updates, CLAUDE.md changes, or root-cause tooling fixes — delivered as PRs the user reviews and merges. Use when a task has met every other Definition of Done criterion, when a /goal goal is met but not yet marked complete, or when the user asks to derive lessons from recent work.
---

# Self-Improvement

The last step of every task: mine what just happened for durable lessons and codify the ones that earn it. This is the most valuable and most dangerous part of the process — a good instruction improves every future session; a bad one biases every future session. Generalize with the big picture in mind, and codify only with conviction.

## When to run

- After every other Definition of Done criterion has passed, before declaring the task done.
- For /goal goals: one pass over the whole effort when the goal is met, before marking it complete. Individual tasks inside a goal skip the per-task pass — their lessons are mined at goal completion, with the full arc in view.
- "No lessons worth codifying" is a valid and common outcome, especially for small tasks — state it explicitly and finish. Never manufacture a lesson to look productive.

## Source ranking

Weigh evidence in this order:

1. **User instructions, corrections, and feedback** — the highest signal, outranking everything else. Anything the user had to say twice is something the system failed to absorb the first time: a top-priority candidate. A lesson that contradicts a stated user preference is wrong, no matter how much other evidence supports it.
2. **Failures with a root cause** — an incident traced to its mechanism. An untraced failure is not a lesson yet.
3. **Wins** — patterns that demonstrably worked and would not be rediscovered cheaply.

Mine the real record, not memory: the session ledger, the conversation (the user's messages above all), per-lane artifacts, PR review threads.

Where each source lives:

- **The session ledger** — in the scratchpad directory listed in the system prompt.
- **The full conversation** — a JSONL transcript under the Claude config directory at `projects/<cwd with slashes replaced by dashes>/<session-id>.jsonl`; the current session is the most recently modified file there, and compaction summaries cite the exact path. Long sessions grow to hundreds of megabytes — never read one wholesale. Extract layers with a script filtering by role: user messages and hook feedback first (highest signal, smallest volume), assistant narration only if needed, then slice for miners.
- **Per-lane artifacts** — subagent transcripts live beside the session transcript; lane ledgers live in the scratchpad.
- **PR review threads** — `gh pr view <number> --comments` and `gh api repos/<owner>/<repo>/pulls/<number>/comments`.

## The codification bar

Codify a lesson only if all of these hold:

- **Durable**: it will matter beyond the task that taught it. Task-specific trivia dies with the task's ledger.
- **Behavior-changing**: a future agent reading it would act differently, and better.
- **Earns its tokens**: skills load into every relevant context; each sentence costs attention forever.

Always ask whether there is a deeper fix. A recurring trap is better eliminated in code — a setup script, a lint rule, a test harness — than warned about in prose. The best instruction is the one made unnecessary.

## The structural lens

Incident mining looks backward at what failed; it cannot see the gaps an effort's own success created. After ruling on the incident lessons, ask a second question: did this effort change the shape of future tasks — a new Definition of Done criterion, a new platform, a new product surface, or a workflow agents will now repeat? If it did, check that the skill surface matches the new shape. Facts documented in a README are findable when read but not discoverable at the moment of need, and a workflow future agents will repeat on every task deserves a trigger-discoverable skill, not just documentation.

## Leanness and removal

Removing instructions is often more valuable than adding them. Skills bias agents: an instruction written for one context misfires in others, and an agent follows a wrong instruction more confidently than no instruction. On every pass, look for existing content that is stale, redundant across skills, or prescriptive enough to push an agent into wrong behavior — and propose its removal with the same rigor as an addition.

## Judgment is never delegated

Subagents may mine a long effort's record and return candidates, but every codification ruling is made at the orchestrator tier, after personally reading the candidate and its evidence. Never codify on a miner's word alone.

## Writing rules

- Follow the skill-manager conventions: frontmatter, trigger-rich description, lean body.
- Write every instruction as a standalone statement of current policy. Never write a delta against history ("previously X, now Y") — the future reader has no such history.
- Match the target file's voice and structure, and place a lesson in the one file where a future agent will look for it — never in two.

## Delivery

- One coherent PR per independent improvement; changes that belong together travel together.
- An improvement PR is almost always documentation-only, so it takes the documentation-only path from CLAUDE.md's Definition of Done: a branch off the main checkout (`self-improvement/<topic>`) with no provisioned worktree, `pnpm run lint` as the only local gate, one review pass, then the PR. An improvement that changes code or tooling instead follows the full Definition of Done.
- NEVER merge these PRs. The user personally reviews and merges each one — codification is a user decision, and these PRs are exempt from the usual merge flow.
- Each PR body states the lesson, the evidence (what happened, where), and why it clears the codification bar.
