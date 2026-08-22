---
name: subagents
description: Spawn subagents and dynamic workflows well — size each task to the context window (~33% of 1M target) and pick the right model tier. Use whenever delegating work to subagents, launching a Workflow, or deciding how to split a task across agents.
---

# Subagents and Dynamic Workflows

The orchestrator delegates execution and keeps its own context lean. The two decisions that make delegation work are **how big to make each subagent's task** and **which model runs it**. Getting the size right matters more than anything else: it is the difference between coherent, trustworthy work and hallucinated, low-quality work.

This skill is **self-improving**. When you discover a better sizing heuristic or a new calibration point, update it.

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

## Empirical calibration (this repo — keep this section growing)

- A **full feature-lane build from scratch** (migration + business layer + routes + tests + gate-until-green) does **not** fit one healthy agent: first-attempt lane agents reached ~33% (**330–337k**) and were **still mid-build**. Lesson: split a lane into coherent sub-slices, or plan an explicit checkpoint/resume, rather than asking one agent to build the whole thing.
- A **resuming agent** — fresh context, pointed at the on-disk state plus the design doc — finishing the *remainder* of a lane sat at only **~23–24% (~232–244k)** partway through. Much healthier, because it skips re-deriving the entire design from sources.
- Implication for feature work: prefer **design (1 agent) → build coherent sub-slices (parallel, one module/layer each) → exhaustive review (fan-out)** over "one agent builds the entire lane."
- A **foundation-lane build** (new test harness + a 36-entry coverage manifest + gates + draft PR, ~1.1k added lines) finished healthy at **~251k (25%)**. Sibling gap-fill lanes (one seed section + manifest entries + browser verification each) averaged **~187k**, and a read-only design investigation over ~4k lines of sources landed at **~172k** — all comfortably single-agent sizes.
- A settled-pattern feature split into **two dependent slices** landed both healthy: the data slice (2 migrations + prod seed + business layer + MCP + 31 tests, ~1.5k lines) at **~229k (23%)**, the UI/display/dev-seed/docs slice at **~319k (32%)** — the second finished fine but had no headroom left; a third concern would have broken it. The follow-up **10-finding fix pass** (one UI interaction redesign, a 3-path authorization fix, test strengthening, a seed refactor, plus a database reseed) also fit one agent at **~326k (33%)**.
- **Browser verification passes are cheap**: a 9-flow E2E run landed at ~165k and a 6-check targeted re-check at ~121k. A **two-platform mobile verification** (build wiring, both devices, Maestro suite, new flow) consumed **~398k over 3h** — past the healthy line. Codified since: the mobile-verification skill now prescribes a shared bring-up followed by one verification agent per platform.
- A **5-dimension review with per-finding adversarial verification** (5 Sonnet finders + 12 verifiers) totaled ~1.47M tokens across 17 agents and produced 12 findings, 10 of which survived and were real — including a critical race a single reviewer had no lens to catch. The per-finding verify stage rejected 2 plausible-but-wrong findings; keep it.
- An **urgent test-determinism fix lane** (empirical diagnosis, seed + spec fixes, simulated-condition proofs, a full E2E suite run, draft PR) landed at **~214k (21%)**, and a **two-job venue lane** (a seed re-anchor plus three new journey specs with death-simulation proofs) at **~266k (27%)** — comfortable single-agent sizes.
- A **docs+config+specs finalize slice** (a full skill rewrite verified claim-by-claim against merged code, a new Playwright project, five new specs, and two full-suite runs) landed at **~340k (34%)** — doc rewrites read wide, so treat a full skill rewrite combined with any build work as the single-agent limit.
- **Reworking a shipped feature splits cleanly at the data/UI seam**, and both halves are comfortable: the data slice (migration + value schemas + business/read paths + MCP + seeds + unit tests) landed at **~232k (23%)** and the surface slice (room card + result pages + Playwright + Maestro + manuals + architecture.md) at **~242k (24%)**. A 13-item consolidated fix pass from review+QA findings ran **~221k**, and an agent-browser full QA pass (three roles, three viewports, DB cross-checks) **~170k**.
- A **full product-surface feature** (a new clinical exam: capture card, derived observation, classification, four result surfaces, seeds, specs, manuals) fit cleanly as **four sequential slices in one worktree**, each ending at green gates: data model + business layer **~241k**, routes + capture UI + MCP tools **~240k**, downstream readers + dev-seed + coverage manifest **~313k**, Playwright specs + manuals + architecture doc **~290k**. Follow-up fix passes and a browser QA walkthrough each ran **174–243k**. Note the slice seam the MCP parity test forces: routes and their MCP tools must land in the same slice, or that slice's `test:unit` cannot go green.
- A **questionnaire instrument on the settled pattern** (the 4th and 5th self-administered questionnaires, with full precedents to mirror) fits comfortably in **three sequential slices**, each ending at green gates: data layer + scoring + unit tests **~173–180k (17–18%)**, routes/UI/journey/labels/MCP **~119–136k (12–14%)**, dev-seed/E2E-spec/docs **~180–235k (18–24%)** — generous headroom throughout, so a 6th instrument could likely merge the middle slice into a neighbor. Note the parity-test seam: MCP tools may only wrap functions a route invokes, so tools land WITH the routes slice, never before. Browser QA (~151–154k) and a CI-failure debug lane doing A/B statement-count measurement plus the fix (**~241k, 24%**) were likewise healthy single agents.
- A second exam built on the same four-slice plan confirmed the first three slices (**~277k / ~215k / ~272k**) but its fourth — Playwright specs + three manuals + architecture.md in one agent — ran **~370k (37%)**, past the healthy line, because the spec-writing added filtered E2E build-and-run loops on top of the doc-wide reading. When both spec work and doc work are substantial, split slice four at that seam. Its five-dimension review (5 Sonnet finders + per-finding verifiers) ran ~1.24M across 8 agents; the fix pass and the browser QA each ~205–210k, consistent with prior runs.
- An exam with a **novel background-job + upload surface** (LLM chart extraction with an editable confirm) ran six slices: data **within a ~300k two-agent wave**, backend job + routes **~278k**, room UI + results read side + an in-agent browser smoke **~402k (40%) — past the line**; when a surface slice builds two surfaces AND smokes them in-browser, split the smoke out. Dev-seed **~222k**, Playwright specs with two full serial E2E runs in-agent **~361k** (full-suite runs are the cost driver — budget one, not two), docs **~232k**. A 12-item consolidated fix pass ran **~311k**, the follow-up 3-defect round **~183k**, browser QA **~247k**. The 5-finder/10-verifier adversarial review ran **~1.55M across 15 agents** and was decisive: it confirmed a critical state-machine trap and a silent record-mismatch race that no builder or QA pass had a lens for. A pre-build **model benchmark** (one agent, ~150k, a dollar of API spend) reversed the default model choice and is cheap insurance for any feature that hinges on an LLM capability.
- A **single-endpoint security hardening** (auth guard + server-side limits on one resource route, TDD) is a small-lane shape where every stage is a comfortable single agent: consumer-mapping Explore **~60k (6%)**, builder **~102k (10%)**, adversarial reviewer **~113k (11%)**, browser QA **~85k (9%)**, consolidated multi-finding fix pass **~174k (17%)**. The reviewer's leverage came from **empirically exercising the installed packages in node_modules** — running the actual parser against crafted inputs — which confirmed two request-level bypasses (a per-part limit multiplied by repeated parts; a content-type fallback that skips the limit entirely) that no black-box unit test or browser pass had a lens for. Charter dependency-boundary reviews to read and run the installed dependency's source, not its docs.
- **Four sibling instrument lanes ran fully parallel** (one per questionnaire, three sequential slices each, 12 agents ~213k average) when every charter listed the shared accumulate-entry files up front with append-only discipline and named the sibling lanes. The merge phase stayed cheap and serial: one rebase agent per lane (**~130–160k**) doing keep-both resolution, a fresh-database types regeneration, and a sorted-line-set patch-identity check on lane-owned paths — all four rebases replayed with zero patch drift. The cross-lane review round (4 reviewers, ~713k) caught two majors every builder and green CI had missed (manuals contradicting deliberate edge-case behavior; a seeded LLM prompt demanding data its observation list didn't grant), so budget it even when per-lane gates are all green.
- A **two-platform mobile verification in the prescribed shape** stays healthy: shared bring-up at **~75–90k**, then one agent per platform at **~102–203k (10–20%)** each, holding across four rounds of verification on the same effort. The counter-lesson from that same effort: a **single builder driven through repeated on-device fix rounds** on one worktree reached **~375k (37%)** by its third round, since each round replays the accumulated device logs and diffs. Hand the third round of fixes on the same surface to a fresh agent pointed at the on-disk state instead of resuming the incumbent.
- An **iOS-share-extension feature** (native shell + bridge + a web receiving route) split cleanly into three slices, two healthy and one overpacked: bridge methods + Expo shell wiring **~190k (19%)**, native verification (config plugin + `expo prebuild` + local simulator build + a real device share drive + a Maestro flow) as its own whole slice **~334k (33%)**, but the **web receiving route ran ~417k (42%) — over the line** because one agent built the route + business layer + MCP tools + Playwright specs + seed flows + the manual + architecture.md *and* ran an in-agent agent-browser smoke. A **bridge- or native-consuming web route that also writes its own specs, seed flows, and docs is two slices**, split at the build/verify seam; never add an in-agent browser smoke to a slice that already spans route+specs+docs. The native-verification slice is the opposite lesson — prebuild→build→device-drive→Maestro is one coherent chain that stays whole at ~33%.

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

Use it to watch a long-running agent's trajectory. If one is approaching ~33% while still far from done, decide deliberately: let it finish (if nearly there) or have it checkpoint its state to disk and hand off to a fresh agent.

## Shrink a task's footprint

- Point the agent at **specific docs and sections**, not "read everything."
- Have agents **return distilled conclusions**, not raw file contents — the summary is the deliverable, not the transcript.
- **Split along natural seams** (by module, by layer, by review dimension) — but not so finely that coherence breaks. Cohesive or dependent work stays in one agent.
- Use `pipeline()`/`parallel()` for genuinely independent units; keep dependent work sequential in one agent.
- **Resume interrupted work with a fresh agent + a summary and the on-disk state**, not by replaying a giant transcript.
- Keep the **orchestrator's own context lean**: delegate, store durable state in the scratchpad ledger, and don't read what a subagent can read for you.

## Model selection

Tier names are version-agnostic: `fable`, `opus`, and `sonnet` are Claude Code model aliases that always resolve to the current model of each family — never pin a specific version in this skill.

Match the tier to the work:

- **Fable** — reserved for the highest-judgment work only: the main orchestrator session, architecture, UX/UI design, the hardest coding tasks and problems, and **final QA** — the last pre-merge audit of a lane, judging with real discernment whether the work truly meets our quality bar. Work is never merged on a lower tier's word alone.
- **Opus** — the default workhorse for everything below that bar: regular feature builds and implementation, fix passes, design-doc drafting within a settled architecture, code review with ≤5 subagents, and agent-browser end-to-end manual testing.
- **Sonnet** — code review with ≥5 subagents (multi-dimension adversarial reviews) and similar wide fan-out work.

Design work splits across the tiers by how much invention it demands. Invention-type design — a new pattern, a new architecture, a shape nothing in the repo prefigures — always runs on Fable. Design that applies a settled pattern to a new surface, where drafting is mostly grounded investigation, sits on the edge: make a fresh judgment call each time between Fable designing directly and Opus drafting for Fable to personally adjudicate against the primary sources. Neither arrangement is pre-approved for the edge — the call is part of the work.

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
