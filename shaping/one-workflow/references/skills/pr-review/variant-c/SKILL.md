---
name: pr-review
description: Review a GitHub pull request with full context — the description, every comment, review, and inline thread, then the diff — judging the big picture personally before multi-angle finding and adversarial verification. Use when asked to review a PR, analyze a pull request, or assess a teammate's changes — including a PR by the-founder, whose PRs the team takes over; use this instead of the native /review command.
---

# PR review

A pull request is a conversation attached to a diff. Reviewing the diff alone repeats questions teammates already asked, contradicts rulings already made, and misses findings other reviewers already anchored; reviewing the conversation without rigor rubber-stamps it. Load everything first, read the diff yourself, judge the big picture, and only then descend into details: hunt for defects from independent angles, verify every candidate, adjudicate the survivors against the project's own record, and write the verdict.

## Phase 0 — Gather everything

From inside the target repo's checkout (`gh` resolves the repo from cwd):

1. `gh pr view <n> --json title,body,author,baseRefName,headRefName,state,additions,deletions,changedFiles,labels` — metadata and description.
2. `gh pr view <n> --json comments` — discussion comments.
3. `gh api --paginate repos/<owner>/<repo>/pulls/<n>/reviews` — prior reviews and their verdicts.
4. `gh api --paginate repos/<owner>/<repo>/pulls/<n>/comments` — inline threads: existing findings, open questions, replies.

`--paginate` is load-bearing on the two `gh api` calls: without it the API returns only the first 30 items and everything later — typically the most recent review round — is silently absent, so the review builds on an amputated record.

An errored fetch is no record at all, not an empty one: these REST endpoints sometimes 404 on a PR that plainly exists (GitHub flakiness), and reading that as "no reviews yet" builds the review on the same amputated record. Before treating the discussion as empty, get positive evidence from a second path — `gh pr view <n> --json reviews` and the GraphQL `reviewThreads` connection cover the same ground.
5. `gh pr checks <n>` — CI state; why a check is red is part of the review.
6. `gh pr diff <n>` — the diff, last, read with everything above in mind.

Before leaving this phase, distill the PR's **governing contracts** from everything gathered: the goal or spec texts riding in comments or the body, rulings from prior rounds, and the scope rules they impose — what the PR must deliver, what it must not touch, which existing behavior it mirrors. Write the contracts down as an explicit list; the later phases judge every finding against it, and Deliver classifies each finding by it. A review that never extracts the contracts leaves scope to be discovered at fix time, where each rediscovery risks growing the PR — and a PR that absorbs out-of-scope fixes never exits review.

The PR's diff is the review scope. When surrounding code is needed, Read files in the local checkout only if it matches the PR's branch; otherwise fetch contents via `gh`. Mind the base: the branch may lag the default branch, so evaluate "missing file / failing check" observations against the base they actually describe, never against current `main` alone.

## Re-reviews

A re-review is a full review of the PR as it now stands: every phase, the whole diff, at full rigor. Prior rounds never narrow the scope — whether earlier findings got fixed is not the question; whether the PR is right as a whole is. Load the history anyway, for communication's sake: credit what got fixed, answer open threads, and don't re-ask what's already ruled — but form the judgment fresh against the current head.

## When the author is the-founder

the founder is the CEO — an engineer without time to drive a feature to the end. By agreement, he contributes PRs instead of filing feature requests, and the team takes them over: the review runs at full rigor (every phase, unchanged), but its frame changes from "requests to the author" to "the takeover work list".

- His PR body usually embeds the original spec he gave his agent (a "Prompt inicial" block). Read it as the authoritative record of intent: where the diff drifts from his own stated spec, the default resolution is toward the spec, and the drift is a finding.
- A finding with more than one defensible resolution is a decision for the user, not a review comment offering options. Collect these decisions during the review and put them to the user as questions — with a recommendation — before any solution is built.
- The verdict is what it takes to make the PR merge-ready ourselves, not a list of change requests. Posting and executing that takeover is the `post-review` skill's job.

## Phase 1 — Read the diff yourself

Read the diff personally before delegating anything. Your own read is the intuition every subagent finding and every teammate opinion gets weighed against — judgment received without it can only be rubber-stamped. When the PR is too large to read wholesale without overflowing your context, read selectively instead: the core of the change, shared modules, schema and contract changes, whatever the discussion argues about — enough to hold your own opinion — and leave exhaustive coverage to the finders.

## Phase 2 — Zoom out

With the full context and your own read in hand, answer the big-picture questions before any detail work. This judgment stays with you — it is never delegated:

- Should this PR exist at all? Is the problem it solves real, and worth solving?
- Is the approach a good idea — does it fit the architecture and the big-picture vision of the product?
- Is there a design under which the problem disappears instead of needing to be solved? A structural alternative that dissolves the problem outranks a patch that handles it.
- Is it beautiful? Elegance takes more than simplicity — judge with aesthetic taste. Beautifully simple is the bar: the right domain language, code that reads as prose, a shape that feels inevitable. Simple alone does not clear it.

The answers set the review's frame. A "no" here changes what the detail phases are for: a PR whose direction is wrong deserves a direction verdict evidenced by a few decisive findings, not a polished list of line comments on code that should not land in this shape.

## Depth

Phases 0–2 and 6 run in full on every review — the context, the personal read, the big-picture judgment, and the decision-record adjudication are never scaled down. Depth sets how heavy Phases 3–5 run (these terms are review depth, not reasoning-effort levels). Use the depth the user names; otherwise choose from the zoom-out verdict and the diff's size and risk:

- **Quick** — a small, low-risk diff with a clean zoom-out: run the existing-discussion angle and one personal line-by-line pass, verify inline, skip the rest.
- **Standard** — the default: every angle, every candidate verified, no sweep.
- **Exhaustive** — high-risk surfaces (shared core modules, schema, hot paths), large diffs, or when asked to be thorough: every angle fanned out, per-candidate verifiers, and the sweep.

A wrong-direction zoom-out verdict caps the detail work at any depth: gather only the decisive findings that evidence the verdict.

## Phase 3 — Find candidates from independent angles

Work through the angles the chosen depth calls for, each surfacing candidates with `file`, `line`, a one-line `summary`, and a concrete `failure_scenario`. Fan the angles out as parallel subagents when the Agent tool is available and the diff is large — the `orchestration` and `subagents` skills govern that fan-out (charters, task sizing, model and effort per stage, verifying what agents report) exactly as they govern any other delegated work; otherwise run the angles yourself, in sequence, skipping none. Do not let one angle's conclusions suppress another's — if two angles flag the same line for different reasons, record both, and pass every candidate with a nameable failure scenario through to verification: finders that silently drop half-believed candidates are the dominant cause of misses.

**Existing discussion.** Every unresolved claim already on the PR — a teammate's concern, a bot's finding — becomes a candidate carrying its author's name, and every open question becomes an item the review must answer. These go through verification like everything else: confirmed ones get credited to their author, refuted ones get answered with the line that disproves them.

**Description accuracy.** Check each claim the PR description makes — results reported, evidence attached, items marked done — against what the diff and the branch's commits actually contain. A claim the branch does not substantiate is a candidate: the description merges into the durable record alongside the code, and the mismatch usually means the body is premature or a final commit was never pushed; commit timestamps against the events the body describes settle which.

**Line-by-line scan.** Read every hunk, then the enclosing function — bugs in unchanged lines of a touched function are in scope (the PR re-exposes or fails to fix them). For every line ask: what input, state, timing, or platform makes this line wrong? Inverted/wrong conditions, off-by-one, null/undefined deref, missing `await`, falsy-zero checks, wrong-variable copy-paste, errors swallowed in a catch that should propagate, unescaped regex metacharacters.

**Removed-behavior audit.** For every line the diff deletes or replaces, name the invariant it enforced, then find where the new code re-establishes it. No answer is a candidate: a removed guard, a dropped error path, a narrowed validation, a deleted test that covered a real case.

**Cross-file trace.** For each changed function, Grep for its callers and check whether the change breaks any call site — a new precondition, a changed return shape, a new exception, a timing or staleness dependency. Check callees too: does a parallel change in the same PR make a call unsafe?

**Language pitfalls.** The classic traps of the diff's language and framework — JS falsy-zero and `==` coercion, Python mutable default arguments and late-binding closures, Go nil-map writes and range-variable capture, SQL injection, timezone/DST drift, float equality — flagged only where the diff introduces an instance.

**Wrapper/proxy correctness.** When the PR adds or modifies a type that wraps another (cache, proxy, decorator, adapter): every method must route through the wrapped instance, not back through a registry or global, and the wrapper must forward everything its callers actually use.

**Reuse, simplification, efficiency.** New code that re-implements an existing helper (Grep shared modules and name the helper to call instead); unnecessary complexity — redundant or derivable state, copy-paste with slight variation, deep nesting, dead code left behind; wasted work — repeated I/O or computation, independent operations run sequentially, blocking work on startup or hot paths. Name the simpler or cheaper form.

**Altitude.** Each change implemented at the right depth, not as a fragile bandaid — special cases layered on shared infrastructure mean the fix isn't deep enough; prefer generalizing the mechanism.

**Conventions.** Check the diff against the rules that govern the changed code: the repo's own `AGENTS.md`/`CLAUDE.md` and binding process docs (in this workspace, `docs/process/engineering-conventions.md` where present). Flag a violation only when you can quote the exact rule and the exact line that breaks it — no style preferences, no "spirit of the doc" inferences.

Cleanup, altitude, and conventions candidates state a concrete cost (what is duplicated, wasted, or which quoted rule is broken) in place of a crash scenario. Correctness always outranks cleanup when trimming the final list.

## Phase 4 — Verify every candidate

Dedup near-duplicates (same defect, same location, same reason → keep one). Then verify each survivor against the diff and the relevant files — via one verifier subagent per candidate when fanning out, or yourself otherwise — returning exactly one of:

- **CONFIRMED** — you can name the inputs/state that trigger it and the wrong output or crash. Quote the line.
- **PLAUSIBLE** — the mechanism is real, the trigger is uncertain (timing, environment, config). State what would confirm it. Plausible is the default for realistic runtime state — concurrency races, nil on a rare-but-reachable path, falsy-zero, boundary off-by-one, retry storms — do not refute a candidate merely for being "speculative".
- **REFUTED** — only when constructible from the code: factually wrong (quote the actual line), provably impossible (show the type/constant/invariant), already handled in this diff (cite the guard), or pure style with no observable effect.

Keep CONFIRMED and PLAUSIBLE; drop REFUTED. A claim you could not verify either way is phrased as a question in the report, not a defect.

Two more gates keep the report free of issues that should not be fixed. A regression or behavior-change claim needs a trigger a real client can produce: if no browser or integration can ever send that input, users see nothing different and the finding is refuted — a forged request counts only when the finding is about what an attacker can do. And before confirming that something is risky, ask whether the risk is actually new: a 60-second cache was once flagged as a dangerous dependency in an app where every request already reads the cache.

Verification also settles each kept finding's **provenance**: introduced by the diff, or pre-existing on the base — proved against the base's own lines (`git show <merge-base>:<file>`), never inferred from the diff's shape. The verifier holds the finding's full evidence at exactly this moment; establishing provenance later means re-reading every finding's context a second time, after conclusions built on the incomplete record have already been presented.

## Phase 5 — Sweep for gaps

At exhaustive depth only: one more pass as a fresh reviewer holding the verified list, re-reading the diff and enclosing functions for defects not already listed — the job is gaps, not re-confirmation. Focus on what first passes miss: moved or extracted code that dropped a guard or anchor, second-tier footguns (a default evaluated once, lock-scope shrink, predicate methods with side effects), setup/teardown asymmetry in tests, flipped config defaults. Nothing new is a valid result — do not pad.

## Phase 6 — Adjudicate against the decision record

Never deliver a verdict before this pass has run, at any depth. Verification proves a finding's mechanism; it does not prove the finding should change the branch — projects rule on their own trade-offs in many places, and a review that checks only a known-limitations bank rediscovers decisions already made. For every surviving finding, hunt the project's complete decision record for a ruling on that exact issue: the shipped docs and recipes, route docstrings and schema descriptions, the design doc, tests that pin the behavior as deliberate, branch commit messages, and the goal texts. A confirmed finding once proposed a guard whose exact opposite the shipped recipe required — the adjudication lived in the recipe, and the proposed fix would have broken the documented walk.

Then hold each survivor to the do-not-fix-what-is-not-broken bar: name the concrete harm — who is harmed, how often, how badly, and whether the triggering state exists in reality — whether the risk is new relative to what the product already accepts elsewhere, and whether the proposed fix would break any documented contract. A finding the record rules on is withdrawn or reported as known-and-accepted, with the ruling quoted; a real mechanism whose harm is negligible is reported as not worth fixing, argued honestly. Only findings that survive both gates reach the verdict.

## Deliver

The deliverable is the analysis in the conversation:

- An overview of what the PR does.
- The big-picture assessment: whether the PR should exist, whether the approach is the right one, and any structural alternative worth naming.
- What checks out: claims verified true, existing reviewers' findings that held (credited by name), and anything notable done well — a review that only lists faults reads as unverified suspicion.
- Findings ranked most-severe first, each with `file:line`, the one-sentence defect, its verdict, its provenance (introduced or pre-existing), and the concrete failure scenario or cost — and each adjudicated against the governing contracts: in scope for this PR, or real-but-banked with the contract that rules it out.
- Answers to the discussion's open questions the review can settle.
- The verdict and its rationale.

Post nothing to GitHub unless asked — when asked, load the `post-review` skill and follow it (inline comments anchored to the diff, follow-up PRs, thread replies). When the findings are ours to fix — the reviewed PR is our own and the user wants them addressed — load the `review-fixes` skill and follow it (triage the certain defects, adjudicate the rest with the user one finding at a time, then land the fixes on the PR's branch).
