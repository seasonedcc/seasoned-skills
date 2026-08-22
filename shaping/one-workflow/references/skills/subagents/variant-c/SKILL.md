---
name: subagents
description: Spawn subagents and dynamic workflows well — size each task to the context window (~33% of 1M target), pick the right model tier, and rule on agents that run past it. Use whenever delegating work to subagents, launching a Workflow, deciding how to split a task across agents, or handling a watchdog alert about a full context.
---

# Subagents and Dynamic Workflows

The orchestrator delegates execution and keeps its own context lean. The two decisions that make delegation work are **how big to make each subagent's task** and **which model runs it**. Getting the size right matters more than anything else: it is the difference between coherent, trustworthy work and hallucinated, low-quality work.

Keep this skill true rather than long: when a real run's measured cost contradicts a band below, correct that band.

## The context budget: aim for ~33% of the 1M window

- Fable, Opus, and Sonnet all have **1,000,000-token** context windows. So **~33% ≈ 330k tokens**.
- These models begin **degrading around 25–33%** window fill. Past ~33%, distrust the output — that is where hallucinations, silently-dropped requirements, and quality regressions appear. Do not trust results from a context much fuller than a third.
- **Design each task to LAND near 33% by the time it finishes** — not to blow past it. The target is the end state of a healthy task, not a ceiling you race toward.
- **Soft rule, not hard:** if an agent is genuinely near the end of its task when it crosses 33%, let it finish — interrupting or compacting mid-task is worse than mild degradation at the finish line. What you must avoid is an agent still doing substantive work at 50%+.

## Sizing: the tradeoff to balance

- **Too small** → over-parallelization. Many agents each holding a partial view produce fragmented, less coherent work with integration seams, duplicated context loading, and coordination overhead.
- **Too big** → the context overflows past ~33%, performance degrades, and either the quality drops (hallucinations, missed requirements) or the agent dies mid-task with its work wasted.
- **Right-sized** = one coherent deliverable an agent can hold entirely in a healthy (<~33%) context, including all the reading and gate-iteration the task requires.

## Estimate a task's token cost BEFORE you spawn

Add up the big consumers:

- **Startup**: the agent's system prompt + your task prompt + any skills it loads. A rich task prompt plus 3–4 skills is easily **20–60k tokens before it does any work**.
- **Reading**: each file ≈ characters/4 tokens. Design docs, research digests, and broad source-tree reading add up fast — a large design doc plus a digest can be **30–60k** on its own.
- **Iteration** (usually the silent killer): every tool result accumulates and is replayed into context on later turns. Gate runs (`lint`/`tsc`/`test`/`build`), `git diff`, and test/build logs each land in full. A build-until-green loop can add **100k+**.
- **Output**: cumulative generated tokens (code + reasoning) count too, though the input side normally dominates.

If the honest sum lands well past ~330k, the task is too big — split it or scope it down before spawning.

## Calibration bands

End-of-task context measured on real runs in this workspace, builders at Opus/xhigh. Size against the band, not against a new data point that agrees with it:

- **A feature lane does not fit one agent.** Built from scratch (migration + business + routes + tests + gate-until-green) it reaches **330–337k while still mid-build**. Split it: a **data + business + tests** slice lands **~330k**, right at the line, and carrying **routes/UI** on top pushes it to **~383k** — routes and UI are always their own slice.
- **Resuming is far cheaper than restarting.** An agent pointed at on-disk state plus the design doc finishes a lane's remainder at **~232–244k**, because it never re-derives the design. So prefer **design (1 agent) → coherent sub-slices in parallel → review fan-out** over one agent per lane.
- **A settled pattern makes unit count nearly free.** 81 near-identical registrations plus tests and scoped gates finished at **~238k** — high unit count is fine in one agent when the pattern is chartered and each unit is small.
- **Test lanes cap by item count.** E2E spec lanes of 3–10 specs land **165k–300k**; 14–16 specs land **342k–377k**, past the line every time — keep spec lanes at ~10 specs. A lane that also builds or extends a **fake-provider surface** runs bigger still (**320k** for fakes + 11 specs, **472k** when extending the fakes and a settings overlay) — split fake construction from spec writing whenever the fake is more than an endpoint or two. A unit-coverage lane over one or two Django apps lands **210k–370k** — split app pairs whose combined surface is large.
- **Fix passes cap near ~10 items.** A 14-item cross-cutting pass (schema moves, queryset extractions, new tests, TDD per behavioral item, 72 files) finished at **~346k**, with every claim needing independent re-verification; split mechanical moves from behavioral fixes when a pass mixes both. A 15-item test-harness fix pass lands **~172k**; 2–4 item surgical or audit-remediation passes **~110–120k**.
- **Single-purpose passes have room to bundle more.** Design-doc drafting **~190–200k**; a browser E2E QA pass (dev server + agent-browser flows + screenshots) **~116k**; a real-client OAuth E2E (CLI client + PTY + browser + DB checks) **~129k**; a coverage-gate/harness-infrastructure build **~183k**; a two-reader route-surface census **~291k** total; a docs-authoring lane (four worked recipes plus a design-doc staleness sweep, every claim verified against the live API) **~260k**.
- **Review fan-out.** Finder agents run **~68–115k** each and per-candidate verifiers **~28–68k** each. Budget **~890k** for a 13-agent pass over a ~1.6k-line diff, and roughly **1.5M** for a goal-scale pass (8 finders + 21 verifiers).

## Measure a live or finished agent's context

Transcripts record per-turn token usage. Extract just the numbers — never read the JSONL wholesale (it overflows your own window). The last turn's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` is that agent's current context occupancy:

```bash
python3 - <<'PY'
import json, os
WINDOW = 1_000_000
FILES = {"<agent-id>": "<label>"}  # fill in ids → labels
for aid, label in FILES.items():
    f = f"/path/to/tasks/{aid}.output"
    if not os.path.exists(f): print(f"{label}: no transcript"); continue
    last = peak = out = turns = 0
    for line in open(f):
        try: o = json.loads(line)
        except: continue
        m = o.get("message"); u = m.get("usage") if isinstance(m, dict) else None
        u = u or (o.get("usage") if isinstance(o.get("usage"), dict) else None)
        if not u: continue
        ctx = u.get("input_tokens",0)+u.get("cache_creation_input_tokens",0)+u.get("cache_read_input_tokens",0)
        if ctx: last, peak, turns = ctx, max(peak,ctx), turns+1
        out += u.get("output_tokens",0)
    print(f"{label}: turns={turns} last={last:,} ({100*last/WINDOW:.0f}%) peak={peak:,} out={out:,}")
PY
```

Use it to watch a long-running agent's trajectory, and to read a finished agent's final occupancy into the calibration bands above.

Never let a workflow run long unmonitored — completion notifications are not monitoring, and a builder can quietly blow past the line an hour before you would otherwise look. Pair every workflow expected to run more than ~30 minutes with the background watchdog, which runs the same extraction across a whole run:

```bash
python3 .claude/skills/subagents/scripts/watchdog.py <workflow-transcript-dir> [<more-dirs>...]
```

It sweeps every agent transcript in those directories every 20 minutes and exits loudly the moment an agent's last-turn context passes 280k while its transcript is still fresh — run it as a background shell so the exit fires a task notification. Launch it as the background command itself, never wrapped in a shell line that re-backgrounds it with an inner "&": the wrapper exits immediately, the harness stops tracking the detached watchdog, and its alert can never notify. When a workflow ends, its watchdog dies by your hand — list the process, kill the exact pid; stale watchdogs quietly sweeping finished runs have accumulated three deep. The Workflow tool result prints the run's transcript dir; that directory is a required argument, and a launch that names none refuses to start rather than quietly sweeping nothing. The known trap is a launch that points the watchdog at nothing real — no directory, or a path that does not exist: it would start happily, sweep nothing, and read as "all clear" for hours, so the script refuses instead. `WATCHDOG_IGNORE` takes a comma-separated list of transcript filenames, to silence agents already ruled on. Relaunch the watchdog after each check-in, and stop it when the workflow ends.

## Stopping an over-threshold agent

**Start every alert-handling with a fresh read of that run's `journal.jsonl`.** The watchdog names only transcripts over the threshold, so an agent that finished under it is invisible to the alert, and an alert on a transcript idle for more than a few minutes is usually a ghost — an agent that has already reported. A new transcript is not necessarily a new stage.

Then rule on **what is ahead of the agent, not on the number**:

- **A mechanical tail ahead** — gates to green, a commit, a push, a checkpoint, the report — means let it finish, even far past the threshold. An agent literally writing its handoff is never worth stopping.
- **Design or judgment ahead** — a centerpiece still to be built, a failing-test debug loop, an unresolved decision — means stop and continue with a fresh agent, even below the threshold. Degraded judgment is the expensive failure; a continuation's re-read is cheap.
- **Rework discovered mid-stage voids a prior let-finish** — it is new work, not the tail. A stage ruled let-finish because only its mechanical remainder was ahead can find a real defect in that remainder and absorb the whole fix-and-reverify cycle with judgment work back in front of it; a fresh continuation finishes the same remainder at a fraction of the context. A stage that discovers rework beyond its charter checkpoints its state and stops, and a watchdog re-armed after a let-finish ruling is armed for exactly this.

Two axes rule alongside:

- **Tree state.** Clean and pushed extends the license: the work is safe and a continuation starts from it. A dirty tree past ~450k revokes it — the exposure is uncommitted work dying with the context.
- **Wave cost.** Stopping a task in a `parallel()` wave that has produced no cached results yet kills every sibling in it. The cost of stopping one over-threshold agent is the whole wave, which routinely rules in favor of letting it finish.

## Shrink a task's footprint

- Point the agent at **specific docs and sections**, not "read everything."
- Have agents **return distilled conclusions**, not raw file contents — the summary is the deliverable, not the transcript.
- **Split along natural seams** (by module, by layer, by review dimension) — but not so finely that coherence breaks. Cohesive or dependent work stays in one agent.
- When splitting data-building work into parallel lanes, check foreign-key direction first: a lane whose models hold non-null FKs to another lane's rows cannot pass its own gates until that lane merges, so it is sequential no matter how disjoint the files look. A planned parallel split failed at charter time when every model in the "independent" lane required the sibling lane's rows.
- Use `pipeline()`/`parallel()` for genuinely independent units; keep dependent work sequential in one agent.
- **Resume interrupted work with a fresh agent + a summary and the on-disk state**, not by replaying a giant transcript.
- Keep the **orchestrator's own context lean**: delegate, store durable state in the scratchpad ledger, and don't read what a subagent can read for you.

## Dynamic workflows

- **Inline task data into the script body — never pass it through `args`.** A Workflow launched with an `args` object can silently arrive as `undefined` inside the script, failing instantly with a missing-args error. Write charters, file lists, and other per-task data as template-literal constants in the script itself.
- **Launch independently-completing units as separate Workflow invocations, not one `parallel()` barrier.** A barrier notifies only when every agent in it finishes, so a downstream slice that depends on just the fastest lane still waits for the slowest. When lanes finish at different times and feed different dependents, give each its own invocation.
- **Consume a finished workflow's own returned result object; never re-pair its findings with verdicts by journal-line order.** Agents complete in a different order than they were submitted, so zipping a journal's lines against a separate verdict list misaligns them — a REFUTED finding reads as confirmed. Read the `{confirmed, refuted}` (or equivalent) object the workflow returns, where each finding already carries its own verdict.
- **In review workflows, dedupe findings BEFORE spawning verifiers, never after.** Parallel finders raise the same defect from different dimensions; verifying each copy independently doubles verifier cost and can return divergent verdicts on the same claim (one CONFIRMED by an empirical probe, one REFUTED by static reading — the probe wins, but only if you notice the collision). Key findings by file/line/claim and verify each defect once.
- **Never pass `isolation: 'worktree'` to `agent()` in this workspace.** The harness would create a worktree of the workspace root repo (the Claude Code settings repo), not of the nested product repo the task actually changes. Charter the agent to create its own isolation instead: a plain `git worktree add` inside the target repo, removed after pushing — the `worktrees` skill covers the lifecycle.
- **A workflow agent's spawn cwd is the orchestrator's session cwd at launch — a drifted artifact, not a signal.** The session cwd moves with every Bash `cd`, so parallel lane agents can all spawn inside one sibling's worktree. Never let an agent infer its lane from where it woke up: the charter names the worktree by absolute path, and the launch prompt states that the spawn cwd is a launch artifact the charter's mandatory `cd` resolves.
- **No backticks inside an `agent()` prompt's template literal.** Charters routinely quote code, and a single backtick terminates the script's template literal — the whole Workflow dies at launch with a script parse error. Quote code fragments in charter prose with regular quotes instead. Say in the charter that this quoting is a constraint on the charter's own text, never a property of the work — a builder once shipped documentation stripped of backticks because its charter said "backtick-free", and the restore had to be a follow-up commit.

## Model selection

Tier names are version-agnostic: `fable`, `opus`, and `sonnet` are Claude Code model aliases that always resolve to the current model of each family — never pin a specific version in this skill.

Match the tier to the work:

- **Fable** — reserved for the highest-judgment work only: the main orchestrator session, architecture, UX/UI design, the hardest coding tasks and problems, and **final QA** — the last pre-merge audit of a lane, judging with real discernment whether the work truly meets our quality bar. Work is never merged on a lower tier's word alone.
- **Opus** — the default workhorse for everything below that bar: regular feature builds and implementation, fix passes, design-doc drafting within a settled architecture, code review with ≤5 subagents, and agent-browser end-to-end manual testing.
- **Sonnet** — code review with more than 5 subagents (multi-dimension adversarial reviews) and similar wide fan-out work.

When a tier is unavailable (a weekly or rate limit), substitute the nearest capable tier and record the substitution in the ledger. (Standing example: when Fable's weekly limit is reached, Fable-tier work runs on Opus at `xhigh` until tokens return.)

## Reasoning effort

Pair every model with a fixed reasoning effort — always:

- **Opus → `xhigh`.**
- **Sonnet → `xhigh`.**
- **Fable → `high`.**

(When a tier is substituted for another, the effort follows the model actually running: Opus standing in for Fable still runs at `xhigh`.)

How to set it:

- **Dynamic workflows** (`agent()`): pass `effort` on *every* call alongside `model` — e.g. `agent(prompt, { model: 'sonnet', effort: 'xhigh', schema, ... })`. Omitting `effort` inherits the session effort, which is **not** guaranteed to match this rule, so always set it explicitly.
- **The `Agent` tool**: it has **no** per-call effort parameter — a directly-spawned subagent inherits the current session's reasoning effort. You cannot raise a single Agent-tool spawn to `xhigh` in isolation. To guarantee a required effort, either launch that agent from a workflow (where `effort` is settable) or run the whole session at the target effort. Call out this limitation whenever it bites (e.g. a directly-spawned agent-browser Opus run that you want at `xhigh`).
