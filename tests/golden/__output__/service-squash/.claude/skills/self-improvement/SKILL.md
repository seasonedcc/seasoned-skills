---
name: self-improvement
description: Record each lesson from a completed task as exactly one issue — on the project when it is project-specific, on the seasoned-skills package when it would hold in every project, on the application repository when it is about that repository's code conventions — searching existing issues first, and proposing new skills, abstractions, and refactors as issues for shaping. Use when a task has met every other Definition of Done criterion, when a /goal goal is met but not yet marked complete, or when the user asks to derive lessons from recent work.
---

# Self-Improvement

The last step of every task: mine what just happened for durable lessons and record the ones that earn it as issues. This is the most valuable and most dangerous part of the process — its issues are the raw material future instructions are shaped from, so a sound lesson improves every future session and a wrong one biases them all. Generalize with the big picture in mind, and record only with conviction.

## When to run

- After every other Definition of Done criterion has passed, before declaring the task done.
- For /goal goals: one pass over the whole effort when the goal is met, before marking it complete. Individual tasks inside a goal skip the per-task pass — their lessons are mined at goal completion, with the full arc in view.
- "No lessons worth filing" is a valid and common outcome, especially for small tasks — state it explicitly and finish. Never manufacture a lesson to look productive.

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

## The filing bar

File a lesson only if all of these hold:

- **Durable**: it will matter beyond the task that taught it. Task-specific trivia dies with the task's ledger.
- **Behavior-changing**: a future agent reading it would act differently, and better.
- **Earns its tokens**: skills load into every relevant context; each sentence costs attention forever.

Always ask whether there is a deeper fix. A recurring trap is better eliminated in code — a setup script, a lint rule, a test harness — than warned about in prose. The best instruction is the one made unnecessary.

Reverify every staleness claim against the system of record at its current tip before filing. A lane reporting a doc, target, or feature missing is evidence about that lane's base commit, not about the default branch — lanes based on an older branch can produce "stale reference" candidates that are false on current main.

## The structural lens

Incident mining looks backward at what failed; it cannot see the gaps an effort's own success created. After ruling on the incident lessons, ask a second question: did this effort change the shape of future tasks — a new Definition of Done criterion, a new platform, a new product surface, or a workflow agents will now repeat? If it did, check that the skill surface matches the new shape. Facts documented in a README are findable when read but not discoverable at the moment of need, and a workflow future agents will repeat on every task deserves a trigger-discoverable skill, not just documentation.

Then ask a third: did the effort change a mechanism, command, or file that a skill in `.claude/skills` describes? Nothing type-checks a skill and no test reads one, so a skill's description becomes false the moment its mechanism changes, and a stale skill misleads future agents more confidently than no skill at all. Grep the skills for whatever the effort touched, and confirm no statement the work made false remains. One that does is fixed by the effort, as "One channel per lesson" describes, before the pass closes.

## Leanness and removal

Removing instructions is often more valuable than adding them. Skills bias agents: an instruction written for one context misfires in others, and an agent follows a wrong instruction more confidently than no instruction. On every pass, look for existing content that is stale, redundant across skills, or prescriptive enough to push an agent into wrong behavior — and propose its removal with the same rigor as an addition. A fragment of the project's own content that would hold in every project is a package lesson like any other: file it on the package, so the content file can thin once the package absorbs it.

## Judgment is never delegated

Subagents may mine a long effort's record and return candidates, but every filing ruling is made at the orchestrator tier, after personally reading the candidate and its evidence. Never file on a miner's word alone.

## One channel per lesson

The pass changes no instructions and opens no pull request. A pull request that fixes instructions the effort itself made false belongs to the effort, not to the pass. Every lesson that clears the filing bar travels as exactly one issue:

- On the project's own repository when the lesson depends on something specific to the project: its repositories, its tooling, its way of working, its infrastructure, this machine.
- On `seasonedcc/seasoned-skills` when the lesson would hold in any project that uses the workflow package.
- On the application repository itself when the lesson is about that repository's own code conventions.

A lesson with a generic core and a project instance is one issue on the package, with the instance as evidence.

A skill statement the effort itself made false is fixed by the effort as part of its own work: in its open pull request, or, when every one of its pull requests has already merged, in a new pull request it opens for that fix. The fix lands at the statement's source, the content file the generated skill's closing section names or the package's own source, never in the generated copy under `.claude/skills/`, which the next sync rebuilds. It is never an issue.

## Deduplicate before filing

Search the target repository's issues first, open and closed, by the lesson's key words, with `gh issue list --repo <target> --state all --search`. Read every plausible match. When an open issue already records the lesson, add the new case as a comment on it, and the comment carries everything an issue carries, anonymity included. When a closed issue records it, reference that issue in the new one, or file nothing when the closed issue's change already shipped the lesson. Never open a near copy.

## What an issue carries

An issue carries the lesson as a standalone statement of policy, the evidence with links to the pull request, run, or thread, why it clears the bar, and suggested wording marked as a suggestion, with no customer personal data. An issue on the workflow package is public: it describes the evidence anonymized, on its own terms, naming and linking nothing private of the project it came from. It is written so a shaping session can start from it without asking anyone.

## Propose upside too

The pass invents as well as corrects. Ask what this effort revealed that could make the system better: a new skill, an abstraction in the product, a refactor, a whole new system. Each proposal is an issue on the right repository. It waits for a shaping session and never arrives as a ready-made change. An agent's idea cannot come back on its own, because its memory ends with the session. The issue is the only door it can return through.

## Urgent defects are not lessons

Something actively harmful right now, such as a hook that blocks legitimate work, is not the pass's to file. Say it in conversation and fix it immediately, with full rigor, as work of its own outside the pass.

## Writing rules

The suggested wording an issue carries follows these rules:

- Follow the `skill-management` conventions: frontmatter, trigger-rich description, lean body.
- Use plain words a person would say out loud. If a teammate reading a sentence cold would have to ask what it means, it is not a lesson yet — rewrite it from the concrete case it came from.
- Write every instruction as a standalone statement of current policy. Never write a delta against history ("previously X, now Y") — the future reader has no such history.
- When a fact is an instance of a growing set, name the mechanism that produces it and how to enumerate it, not the instances — a hardcoded list is stale by the next addition, while a mechanism plus its grep stays true.
- Match the target file's voice and structure, and place a lesson in the one file where a future agent will look for it — never in two.
- A lesson about an application repository's code shape — organization, query boundaries, model/service responsibilities, test structure, naming — belongs in that repository's own conventions document, and its suggested wording targets that document, never an equivalent rule in a workflow skill.

## Where lessons go

A lesson about this skill travels as an issue, never as an edit to this file, which is regenerated on every upgrade: on the project when it is specific to this project, whose part of this skill belongs in `workflow-content/self-improvement.md`, and on the workflow package when it would hold in every project.
