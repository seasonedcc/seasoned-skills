---
name: subagents
description: Spawn subagents and dynamic workflows well — size each task to the context window (~33% of 1M target), pick the right model tier, and rule on agents that run past it. Use whenever delegating work to subagents, launching a Workflow, deciding how to split a task across agents, or handling a watchdog alert about a full context.
---

# Subagents and Dynamic Workflows

The orchestrator delegates execution and keeps its own context lean. The two decisions that make delegation work are **how big to make each subagent's task** and **which model runs it**. Getting the size right matters more than anything else: it is the difference between coherent, trustworthy work and hallucinated, low-quality work.

## The context budget: aim for ~33% of the 1M window

- Fable, Opus, and Sonnet all have **1,000,000-token** context windows. So **~33% ≈ 330k tokens**.
- These models begin **degrading around 25–33%** window fill. Past ~33%, distrust the output — that is where hallucinations, silently-dropped requirements, and quality regressions appear. Do not trust results from a context much fuller than a third.
- **Design each task to LAND near 33% by the time it finishes** — not to blow past it. The target is the end state of a healthy task, not a ceiling you race toward.
- **Crossing the line opens a decision, not a verdict.** An agent already past it is ruled on by what is still ahead of it — see *Stopping an over-threshold agent*.

## Sizing: the tradeoff to balance

- **Too small** → over-parallelization. Many agents each holding a partial view produce fragmented, less coherent work with integration seams, duplicated context loading, and coordination overhead.
- **Too big** → the context overflows past ~33%, performance degrades, and either the quality drops (hallucinations, missed requirements) or the agent dies mid-task with its work wasted.
- **Right-sized** = one coherent deliverable an agent can hold entirely in a healthy (<~33%) context, including all the reading and gate-iteration the task requires.
- **Finding the right slice size and the right split between slices IS the design work** — the hardest judgment in the project, not a preamble to it. Spend real thought on the boundaries before chartering.
- **"Never split below surface coherence" is a recovery mechanism, not a license to charter big.** It rescues a slice that was already sized wrong; it never justifies sizing one that way. When the boundaries turn out wrong, re-draw them.
- **A slice that changes a shared input shape — a schema field, a function signature — inherits every `tsc`-forced caller repoint in the same gate cycle.** The gates force the whole cascade into that slice's window. Size the cascade in, or draw the boundary at a type-stable seam.

## Hybrid slicing: vertical builds, batched verification

Build stages stay vertical and small — one coherent cut through schema, business, routes and UI, proved by a single live smoke.

Verification batches into its own dedicated stages: dev-seed sections, E2E specs, docs articles and screenshots, browser QA. Verification carries high **fixed** costs — a dev server, a seeded database, a browser session, the screenshot container, the responsive matrix — that a batched stage pays once and per-slice verification would pay again for every slice. Docs is its own stage even inside a verification lane: a stage carrying seeds, the seed manifest and specs is already full before its docs phase starts.

## Estimate a task's token cost BEFORE you spawn

Add up the big consumers:

- **Startup**: the agent's system prompt + your task prompt + any skills it loads. A rich task prompt plus 3–4 skills is easily **20–60k tokens before it does any work**.
- **Reading**: each file ≈ characters/4 tokens. Design docs, research digests, and broad source-tree reading add up fast — a large design doc plus a digest can be **30–60k** on its own.
- **Iteration** (usually the silent killer): every tool result accumulates and is replayed into context on later turns. Gate runs (`lint`/`tsc`/`test`/`build`), `git diff`, and test/build logs each land in full. A build-until-green loop can add **100k+**.
- **Output**: cumulative generated tokens (code + reasoning) count too, though the input side normally dominates.

If the honest sum lands well past ~330k, the task is too big — split it or scope it down before spawning.

## Empirical calibration

The project's calibrations — measured end-of-task context costs for its recurring shapes of work, and the sizing lessons drawn from them — live in the committed calibration file: `{{calibration-file}}`. Read it before chartering; size against its bands, not against a single new data point that happens to agree with them.

The discipline the file follows:

- **Every calibration is Definition-of-Done-relative.** A stage's cost is dominated by the verification the Definition of Done makes it carry, so each entry is stamped with the Definition-of-Done era it was measured under, and entries from a lighter era read as floors rather than estimates.
- **Any change that expands the Definition of Done carries a calibration review in that same change.** A gate added without re-deriving what a unit of work now costs is an incomplete change, because every calibration just silently went stale.
- **Item count is the wrong proxy for a lane's size.** What predicts cost is the number of distinct surfaces touched and whether verification sits inside the stage.
- **When a real run's measured cost contradicts a band, correct the band.** Calibration updates are lessons about the project itself: they travel as pull requests on the project, editing the calibration file — never this skill.

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

Use it to watch a long-running agent's trajectory, and to read a finished agent's final occupancy into the calibration file.

Never let a workflow run long unmonitored — completion notifications are not monitoring, and a builder can quietly blow past the line an hour before you would otherwise look. Pair every workflow expected to run more than ~30 minutes with the background watchdog, which runs the same extraction across a whole run:

```bash
python3 .claude/skills/subagents/scripts/watchdog.py <workflow-transcript-dir> [<more-dirs>...]
```

It sweeps every agent transcript in those directories every 20 minutes and exits loudly the moment an agent's last-turn context passes 280k while its transcript is still fresh — run it as a background shell so the exit fires a task notification. The threshold and sweep cadence are package-versioned constants: tuning them is a release of the workflow package, never a local edit. Launch it as the background command itself, never wrapped in a shell line that re-backgrounds it with an inner "&": the wrapper exits immediately, the harness stops tracking the detached watchdog, and its alert can never notify. The Workflow tool result prints the run's transcript dir; that directory is a required argument, and a launch that points the watchdog at nothing real — no directory, or a path that does not exist — would start happily, sweep nothing, and read as "all clear" for hours, so the script refuses to start instead. `WATCHDOG_IGNORE` takes a comma-separated list of transcript filenames, to silence agents already ruled on. Relaunch the watchdog after each check-in; when a workflow ends, its watchdog dies by your hand — list the process, kill the exact pid. Stale watchdogs quietly sweeping finished runs accumulate otherwise.

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
- When splitting data-building work into parallel lanes, check foreign-key direction first: a lane whose models hold non-null foreign keys to another lane's rows cannot pass its own gates until that lane merges, so it is sequential no matter how disjoint the files look.
- Use `pipeline()`/`parallel()` for genuinely independent units; keep dependent work sequential in one agent.
- **Resume interrupted work with a fresh agent + a summary and the on-disk state**, not by replaying a giant transcript.
- Keep the **orchestrator's own context lean**: delegate, store durable state in the scratchpad ledger, and don't read what a subagent can read for you.

## Dynamic workflows

- **Inline task data into the script body — never pass it through `args`.** A Workflow launched with an `args` object can silently arrive as `undefined` inside the script, failing instantly with a missing-args error. Write charters, file lists, and other per-task data as template-literal constants in the script itself.
- **No backticks inside an `agent()` prompt's template literal — and escape nothing SQL-style.** Charters routinely quote code, and a single backtick terminates the script's template literal — the whole Workflow dies at launch with a script parse error; a doubled apostrophe (`''`) is a SQL escape that is a syntax error in a JS string. Quote code fragments in charter prose with regular quotes instead. Say in the charter that this quoting is a constraint on the charter's own text, never a property of the work — a builder once shipped documentation stripped of backticks because its charter said "backtick-free", and the restore had to be a follow-up commit.
- **Launch independently-completing units as separate Workflow invocations, not one `parallel()` barrier.** A barrier notifies only when every agent in it finishes, so a downstream slice that depends on just the fastest lane still waits for the slowest. When lanes finish at different times and feed different dependents, give each its own invocation.
- **Consume a finished workflow's own returned result object; never re-pair its findings with verdicts by journal-line order.** Agents complete in a different order than they were submitted, so zipping a journal's lines against a separate verdict list misaligns them — a REFUTED finding reads as confirmed. Read the `{confirmed, refuted}` (or equivalent) object the workflow returns, where each finding already carries its own verdict.
- **In review workflows, dedupe findings BEFORE spawning verifiers, never after.** Parallel finders raise the same defect from different dimensions; verifying each copy independently doubles verifier cost and can return divergent verdicts on the same claim (one CONFIRMED by an empirical probe, one REFUTED by static reading — the probe wins, but only if you notice the collision). Key findings by file/line/claim and verify each defect once.
- **Read a run's `journal.jsonl` for what it actually records.** It logs `started` events with cache keys; a result appears only once its call completes. New agents starting does not mean earlier stages finished, and two entries sharing a cache key are a **retry of the same `agent()` call**, not the next stage. Derive which lane an agent belongs to from the worktree paths inside its transcript, never from `parallel()` launch order.
- **A fleet that dies instantly on a session or usage limit relaunches from its persisted scripts.** Every Workflow invocation's tool result names the script file it persisted; once capacity returns (the user may switch subscriptions), re-invoke each with `{scriptPath}` — no need to resend script bodies. Before relaunching, run `git worktree list`: an agent killed mid-provisioning leaves a half-provisioned lane (worktree present, install and databases incomplete) that breaks the relaunched agent's own setup — tear such lanes down with `seasoned-skills teardown <lane>` first.
- **Freshly-spawned agents dying instantly with zero tool uses are a provider-side incident, not a bad charter.** The signature is a transcript of a few dozen KB — a system prompt and an overload error, nothing else — where a working agent's runs to megabytes. Relaunching straight into it burns the whole fleet again, so stop relaunching and check the provider's status page: your own session keeps answering right through such an incident, so its health proves nothing about new spawns. Back off on a widening timer (10 minutes, then 30). When it fires, relaunch **one** lane as a probe and fan the rest out only once that probe's transcript is well past the death signature and still growing; if the probe dies too, extend the backoff and re-read the status page. Nothing is lost while you wait — an agent that never ran wrote nothing — so spend the wait on work only you can do anyway: reviews, adjudications, skill edits.
- **A script amendment is latent until the run is stopped and resumed.** A live run holds the script it loaded, so editing the file changes nothing about the stages still to come — stop the run, amend, resume. On resume, every already-run stage's prompt must stay byte-identical or its cached result is lost and the stage re-runs from scratch.
- **Never pass `isolation: 'worktree'` to `agent()`.** A shipped hook blocks the harness's worktree-isolation option with guidance instead of letting it half-work: a harness-created worktree is unprovisioned, so an agent spawned into one believes it has a lane and runs against resources it does not own. Charter the agent to create its own isolation instead: `seasoned-skills provision <lane>` when the task needs env files, databases, or gates; a plain `git worktree add` (removed after pushing) for deliberately unprovisioned work like read-only review or docs-only edits.
- **A workflow agent's spawn cwd is the orchestrator's session cwd at launch — a drifted artifact, not a signal.** The session cwd moves with every Bash `cd`, so parallel lane agents can all spawn inside one sibling's worktree. Never let an agent infer its lane from where it woke up: the charter names the worktree by absolute path, and the launch prompt states that the spawn cwd is a launch artifact the charter's mandatory `cd` resolves.

## Model selection

Match the tier to the work. Model names here are family names, never pinned versions: spawns pass Claude Code's model aliases (`fable`, `opus`, `sonnet`), which resolve to each family's current model, so the skill tracks every release without edits — keep it that way.

- **Fable** — reserved for the highest-judgment work only: the main orchestrator session, architecture, UX/UI design, the hardest coding tasks and problems, and **final QA** — the last pre-merge audit of a lane, judging with real discernment whether the work truly meets our quality bar. Work is never merged on a lower tier's word alone.
- **Opus** — the default workhorse for everything below that bar: regular feature builds and implementation, fix passes, design-doc drafting within a settled architecture, code review with ≤5 subagents, and agent-browser end-to-end manual testing.
- **Sonnet** — code review with ≥5 subagents (multi-dimension adversarial reviews) and similar wide fan-out work.

Design work splits across the tiers by how much invention it demands. Invention-type design — a new pattern, a new architecture, a shape nothing in the repo prefigures — always runs on Fable. Design that applies a settled pattern to a new surface, where drafting is mostly grounded investigation, sits on the edge: make a fresh judgment call each time between Fable designing directly and Opus drafting for Fable to personally adjudicate against the primary sources. Neither arrangement is pre-approved for the edge — the call is part of the work.

## Reasoning effort

Pair every model with a fixed reasoning effort — always:

- **Opus → `xhigh`.**
- **Sonnet → `xhigh`.**
- **Fable → `high`.**

How to set it:

- **Dynamic workflows** (`agent()`): pass `effort` on *every* call alongside `model` — e.g. `agent(prompt, { model: 'sonnet', effort: 'xhigh', schema, ... })`. Omitting `effort` inherits the session effort, which is **not** guaranteed to match this rule, so always set it explicitly.
- **The `Agent` tool**: it has **no** per-call effort parameter — a directly-spawned subagent inherits the current session's reasoning effort. You cannot raise a single Agent-tool spawn to `xhigh` in isolation. To guarantee a required effort, either launch that agent from a workflow (where `effort` is settable) or run the whole session at the target effort. Call out this limitation whenever it bites (e.g. a directly-spawned agent-browser Opus run that you want at `xhigh`).
