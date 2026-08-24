# seasoned-skills

The seasoned-skills package: the Seasoned workflow — doctrine, practice skills, an optional stack layer, deterministic code, and corpus machinery — shipped as a public npm package with a command-line tool, so a project adopts the workflow with one install and stays current by upgrading a version. TypeScript on Node; prose lives as markdown fragments and weaving is typed composition code.

## Essential commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Compile the CLI and library to dist/
pnpm run check        # Biome lint + format check
pnpm run tsc          # Type-check
pnpm run test:unit    # Unit tier
pnpm run test:golden  # Golden-output tier (snapshot the generated trees)
pnpm run test         # Both tiers
```

A template or fragment change is reviewed as a diff of what projects will actually receive: the golden tier snapshots the full generated tree per fixture shape, and every tested value of every option is covered by at least one fixture.

## Tooling

- **Shell scripting:**
  - Never rely on shell-specific constructs like bash's `${PIPESTATUS[0]}` — the shell varies by environment, and such constructs can silently no-op elsewhere. When a piped command's success matters, echo each step's exit code explicitly (`cmd | tail -5; echo "exit=$?"` reports tail's status, not cmd's) or avoid the pipe.
  - Remember zsh does not word-split unquoted variable expansions: `git diff -- $PATHS` with a space-separated list in `$PATHS` passes ONE pathspec that matches nothing, and the silently-empty output can read as a clean verification — write the paths out literally or use an array.
  - Never name a shell variable `status`: in zsh it is a read-only alias of `$?`, so `status=$(...)` aborts the script instantly with `read-only variable: status` — a background CI watch died on its first assignment this way, and the one-line error was all it left behind. Use a descriptive name (`checks_json`, `run_state`) instead.
  - When a run's outcome will be judged from its output, capture the whole log (`cmd > file 2>&1; echo "exit=$?"`) and read the file — a `| tail -N` window can be filled entirely by block-buffered prints that only flush at process exit, making a healthy run look like it died midway.
  - A background task's status is never the verdict on the command it ran; the log's `exit=` line is. That trailing `echo` makes the task's own exit code always 0, so a completion notification's "exit code 0" says nothing about the command — a failed e2e suite once read as a successful task this way. A "killed" status is no verdict either: read the log to distinguish an externally killed run from a real failure, since a run killed by host contention shows no failures in its log and treating the status as a result throws away a completed run's evidence. In a multi-gate run, every gate that already produced its own reconciled `exit=` line is complete evidence: keep it, and rerun only the gates that never produced one.
  - A poll loop's exit condition must distinguish "condition met" from "the check itself failed": counting matches with `$(cmd | grep -c pending)` reads 0 both when nothing is pending and when `cmd` dies on a transient error, so one network hiccup ends the loop with a false "done" — a CI poll once declared two pending runs concluded this way. Require positive evidence (non-empty output of a successful command) before treating the condition as met.
- **Working directory:** the session's cwd drifts between shell calls, so every shell command starts with an explicit `cd` to its target directory — no exceptions for reads or one-liners: deciding per command whether location matters is exactly the judgment that fails, and a relative path resolved in the wrong checkout silently reads or writes the wrong repo.
- **CI watches:** a continuous-integration watch is a completion signal only — its exit code is never the verdict, because the watch command has reported success on genuinely failed runs. The verdict comes from a fresh direct read of the check states after the watch returns, before anything acts on it.
- **Language:** in conversation, always answer in the language the user is speaking to you, whatever it is — never switch languages because the artifacts under discussion are written in another one. Match the language of whatever you are editing.
- **Cross-org references stay private:** the user sometimes shares another organization's work (a PR, a repo, a pattern) as inspiration. Never mention those sources in anything visible in this org — PR bodies, commit messages, code, comments, or issues. Describe the resulting change entirely on its own terms; the reference lives only in the conversation and in subagent charters.

## Coding style

- Do not add backwards compatibility to plans or implementations unless you are 100% confident it is necessary. Unnecessary compatibility only adds complexity.
- Do not add comments to the code unless it's an incredibly complex operation
- Avoid abbreviations when naming things. That goes for SQL statements as well.
- Avoid Hasty Abstractions: it is OK to repeat things here and there until the right abstraction emerges.
- Only extract abstractions to new files if you need to share them among more than one file. Otherwise, extract them in the same file.
- Follow the surrounding repo's conventions for everything else — its linter config, naming, and idiom are the local law.

## Fixing Bugs

When addressing a bug, follow a test-driven development approach:

1. **Red** – Write a test that reproduces the issue and fails.
2. **Green** – Implement the minimal fix so the new test passes.
3. **Refactor** – Clean up the solution while keeping all tests green.

## Quality bar

We care enormously about code quality. Please ensure our code is a work of art, always as simple as it can be, with the right domain language and prose. NEVER compromise on this quality bar to save time or tokens.

## Checkouts and worktrees

Every repo's local checkout stays on its default branch at all times — branch work happens only in worktrees. Before starting any type of work involving a repo — building, but equally read-only work like audits, reviews, and architecture questions — `git fetch origin` and fast-forward the default branch first. A stale checkout silently invalidates whatever reads it: a coverage audit once ran against a main that was six commits behind and would have rediscovered a gap the missing commits had already closed. If a checkout is dirty or has diverged from origin, stop and surface it instead of forcing it current.

Independent tasks run in isolated git worktrees, each provisioned with its own resources. Use `seasoned-skills provision <lane>` / `seasoned-skills teardown <lane>`, and load the `worktrees` skill for the lifecycle, naming conventions, and guardrails.

ALWAYS work in an isolated worktree unless told otherwise. The one exception is a documentation-only change (defined in the Definition of Done): it uses no provisioned resources, so it runs in a plain `git worktree add` with no provisioning — never on the main checkout's branch.

When the default branch advances under a long-lived feature branch, load the `main-sync` skill before syncing it in — the sync is a reviewed lane with its own obligations, not a mechanical merge.

## Orchestration

These instructions are for the top-level session — the orchestrator. If you are a subagent (you were spawned with a specific task and your final report goes back to a coordinator), they are not addressed to you: execute your task directly — read, build, and test yourself — and never spawn subagents, launch workflows, open PRs, or merge unless your task instructions explicitly say to.

Act as the orchestrator on every task, not just during `/goal` loops. Delegate execution to subagents and dynamic workflows and keep your own context lean: subagents do the heavy reading, building, and testing, and report conclusions back — don't read what a subagent can read for you. Agents type; you decide, triage, and read diffs. Personal edits are for single-line-scale surgical changes only — when writing the charter would cost more than the edit.

Merging into the default branch is the user's act: open the PR and stop. Merge only when the user explicitly asks — a green CI run or an approved review never implies that authorization.

Load the `subagents` skill before spawning subagents or dynamic workflows — it covers which model tier and reasoning effort to use for each kind of work and how to split tasks. Load the `orchestration` skill alongside it — it covers charters, verifying subagent claims, recovery after interruptions, and shipping lane PRs. Size every subagent task so its context lands at roughly one-third of the 1M-token window by completion, since these models start degrading past ~25–33% fill.

Break the work down however you think is best, as long as you respect dependencies: work that depends on other work only starts when the dependency has fully landed. Independent work runs in parallel, each piece in its own worktree. Use well-designed dynamic workflows whenever the work allows for parallelism.

Long gates belong to you, the orchestrator: a builder's charter ends at commit — or commit and push — and stops there, with only the fast, cheap checks (lint, type-checking the affected files) run in the builder's own foreground. Run the full gates yourself as your own background shells; you own pull request and merge outright, and you own push whenever the charter stopped at commit.

Every process a lane needs beyond a single turn — a development server, a worker — runs as its own harness background task, never forked with `&` inside another task's shell, and every lane process is swept at session end. NEVER kill processes by pattern: `pkill -f` and its relatives fire at processes nobody inspected, including permanently running services. Sweep with `seasoned-skills sweep --lane-processes` — it lists and kills by lane, only ever by exact process id.

Our baseline is all checks passing: every touched repository's gates, green. Establish it empirically before the first lane launches — run the full gates on a clean checkout of the base and record the numbers; a baseline assumed instead of measured hides pre-existing breakage inside every lane's results. Whenever that baseline gets lost for any reason, stop everything and restore the baseline with the highest quality level. The baseline also includes the integrity of the checks themselves: a guard that cannot see what it claims to protect, a coverage hole a suite cannot notice, or seeded state scheduled to diverge from the product is a baseline loss even while CI is green. Fix such gaps immediately upon discovery — never bank them as findings or file them as issues.

Long tasks get compacted several times, so keep a scratchpad ledger file with all the durable lessons and state you'll need after compaction. Keep it current at every moment, never deferring updates until the window fills: the user monitors your context from outside and initiates compaction, which can land at any point without warning, so never ask for one. NEVER trust your compacted context. Always reground yourself on the ledger and the real sources of truth: our codebase, PRs, prototypes, etc.

## Talking with the user

When you need the user's input, ask in regular conversation, and keep working on whatever doesn't depend on the answer. Ask exactly one question per message and wait for the answer — never bundle multiple questions, even related ones. The same rule governs guided manual work: when walking the user through steps they perform themselves, send exactly one step per message and wait for their confirmation before sending the next. Present before asking: the user must never meet a decision for the first time inside a question's options. Every question carries your own recommendation — a question without a formed opinion delegates the reasoning to the user, masked as a decision. When discussion revises a proposal, re-present the full item before asking for the ruling: the user adjudicates the whole picture, never a delta. Lay out the finding in conversation text first — the user-visible behavior and stakes before the mechanism — and pose the question only once that story is on the table. Talk to the user in plain language — no effort-internal jargon, and no shorthand invented during the work. When the user says they do not understand, the explanation failed: re-explain concretely, with a real example or a real scenario, never by restating the same terms. A question from the user is a request for information, never authorization to start work — answer it directly and with the numbers or facts it asked for before anything else, change nothing as a side effect of answering, and stop; supporting context comes after, and an answer that reframes the question or changes the subject reads as no answer at all. If the answer reveals something worth acting on, propose the action and wait for the ruling. Never perform a step the user has reserved for themselves (manual testing, personally experiencing a flow).

## Working with /goal goals

A `/goal` goal follows the same orchestration approach as everything else. The one difference: a goal allows multiple PRs to be merged during development — always into the goal's feature branch, never into the default branch. Every goal develops on a feature branch: use the one the goal names, or create and name one yourself when it doesn't. As you personally review each PR, feel free to merge it into the feature branch when you consider it ready. The only rule is not to merge broken work. Landing the feature branch on the default branch follows the standing rule: only when the user explicitly asks.

As soon as the goal's feature branch exists, open a draft PR from it to the default branch, and after every merge into the branch rewrite the body so it always describes the branch's present contents to an external reader — current truth, never history. The PR stays draft throughout the goal; marking it ready and merging remain the user's acts.

When you identify a coherent body of follow-up work that exceeds the current scope, propose it as a goal with drafted copy rather than waiting to be asked for one. Goal copy drafted for the user to set must come in under /goal's 4,000-character limit. After a context compaction mid-goal, re-read the full active goal text before resuming work — a compacted summary of the goal is not the goal, and the goal's own instructions outrank the ledger's shorthand. Read the goal's text again before answering any question about the goal's product scope or intent, at any point in the goal: it is the authority, above the PR body and the ledger notes that paraphrase it.

During `/goal` loops, whenever the user may be away, ask for their input through questionnaire questions instead of regular conversation — the questionnaire is the only tool that makes the goal-checker agent stop. If you ask through regular text and the user is not around at that point in time, the goal-checker agent will prompt you to continue working until you reach the goal and your message will be lost. When the user is present and actively conversing, use plain conversation and never put a questionnaire in front of them.

When the goal is met, load the `self-improvement` skill and run it once over the whole effort's record before marking the goal complete.

## Definition of Done

Quick iterations: when the user explicitly invokes `/quick`, the reduced Definition of Done in the `quick` skill replaces this list for that task. Quick mode is never self-selected and never suggested — only the user's `/quick` turns it on, and its rules live in the skill.

Documentation-only changes: when every file in the diff is prose the application never loads — docs, skills content, README, the workflow's own content files — the checklist collapses to: an unprovisioned worktree, the fast gates as the only local step, no leftover comments, a single review pass over the committed diff — fix what it surfaces — and a PR with CI green. Every other criterion below exists for files the application loads, so none of them can apply; skip them outright, no written justification needed. The self-improvement criterion still stands, though for a diff this small "nothing to codify" is the usual outcome — and a self-improvement PR never triggers a self-improvement pass of its own. The moment the diff also touches code, scripts, or any other configuration, the full list applies.

- A task is not done unless `pnpm run check`, `pnpm run tsc`, and `pnpm run test:unit` are all passing.
- A task is not done if it has leftover comments. ALWAYS remove leftover comments before finishing. Our work should NOT add comments unless it's an incredibly complex operation.
- A task is not done if it has not passed the `pr-review` skill's loop, run against the draft PR: the loop reads the PR's description and discussion alongside the committed branch diff, which a bare diff review never sees, and its angles include a conventions-compliance pass against the project's own committed conventions and doctrine. Commit the work on its branch and open the draft PR first — a review run from anywhere else silently reviews the wrong change. Do not take the review's findings at face value. Loop until YOU are satisfied with the quality.
- After every other criterion passes, load the `self-improvement` skill: derive the task's lessons and run the skill's two channels for the ones worth codifying. A self-improvement PR is marked ready only by the user — never mark one ready or merge it yourself. Finding nothing to codify is a valid outcome. Tasks inside a `/goal` goal skip this step — the goal runs a single self-improvement pass when it is met.

## Additional warnings

- The `shaping/` folder is the project's shaping documents, excluded from the gates — never lint, format, or "fix" it as a side effect of package work.
- Reference corpora are never committed: the shaping skill's `references/` tree is built locally by the corpus machinery and stays gitignored.
