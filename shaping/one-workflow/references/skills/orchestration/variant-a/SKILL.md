---
name: orchestration
description: Run delegated work reliably — writing subagent charters, verifying subagent claims, keeping judgment at the orchestrator tier, ledger discipline, recovering from interruptions, and shipping/merging lane PRs. Use when spawning subagents or workflows, coordinating parallel lanes, resuming after a session limit or compaction, or rebasing and merging a lane's PR. The subagents skill covers task sizing and model choice; this skill covers everything after the spawn.
---

# Orchestration

Delegation only works when the orchestrator treats every subagent claim as unverified and every judgment call as its own. These rules were each paid for by a real incident.

## Charters

A charter is the task prompt a subagent receives. Requirements:

- Reference every document by **absolute path** — a relative path resolves differently (or not at all) in the agent's working directory.
- When parallel lanes could touch the same module, name the sibling lanes and give each an explicit **do-not-touch list** of files/functions the others own. For shared files that only accumulate entries (routes config, nav layout, seeds), say up front that rebase conflicts there resolve keep-both.
- At most **one repo-mutating agent per worktree** at a time, and an agent that verifies against a builder's live worktree is read-only toward it. A concurrent sibling's `git add`/commit sweeps the other agent's half-finished files into an unrelated commit, and untangling that means rewriting the branch tip.
- Include a **stop-on-contradiction clause**: if the charter's factual premise (a claimed bug, a claimed missing feature, a spec citation) doesn't survive verification against the primary source, the agent halts that item and reports with citations instead of inventing. "Verified already correct, no change made" is a valid, expected outcome.
- When two reference sources disagree, the charter names the conflict for adjudication — it never silently picks one. A charter's factual claims are no more trustworthy than a builder's until verified.
- Instruct agents to run slow verification commands (build, tsc, tests) synchronously in the foreground. A workflow agent that backgrounds a check and ends its turn waiting on a notification is terminally stalled — its turn ending is final.
- Write each new charter/script fresh with the Write tool. Deriving one by programmatically splicing a previous one introduces silent syntax errors.
- Address every `SendMessage` by looking up the recipient's task id in the ledger head at send time, never from memory. A charter delivered to the wrong lane's agent reads as an order to abandon its own work and take over another lane's, and only the recipient's own do-not-touch clauses stand between that misdelivery and a corrupted worktree.
- A parameterized script must parse `args` defensively (string-or-object) and hard-throw on any missing required field — a silently-undefined interpolation produces a plausible-looking empty result that reads as a clean pass.

## Verify, never trust

- Re-run the gates yourself before advancing any stage on a subagent's self-report.
- Reconcile numbers exactly: baseline + computed delta = measured, and identical across two runs. A mismatch is a hard stop, not noise.
- A task counts as **launched** only when its task/run id from the tool result is in the ledger. A written script or a narrated intent is not a running task.
- Check a subagent's "the environment is broken / the data is gone" blocker against the primary source before acting on it — a snapshot race presents exactly like a destroyed environment, and a direct `psql` query settles which one it is in seconds.
- A review or QA returning zero findings is only a clean pass if its agents all completed. Errored finders, an implausibly fast run, or a wrong agent count mean the run is broken — relaunch it.
- Independently probe a shipping agent's claimed git state (`git merge-base <lane> origin/main` vs origin/main's tip) before merging. Verify mechanical batch edits landed by grepping the expected before/after state, not by exit code.
- Personally source-read any confirmed "inconsistent with spec/reference" finding before directing the fix — especially when the fix would reverse a prior ruling. A finding's observation can be accurate while its verdict of "wrong" is not.
- Audit PR-body citations ("per spec X", "per source Y at file:line") against the actual cited location, and check any "deferred as polish / out of scope" claim against the actual contract. Builders produce plausible but fabricated attributions.
- Any change to `app/framework/` made by a fix/QA agent gets the orchestrator's personal diff read before shipping — its blast radius exceeds any lane's review scope.
- A prepared mutation of live external state (an app spec, a DNS record, a provider config) is built from a snapshot, and snapshots drift even mid-session — the user can change the live state under you. Refetch and re-diff immediately before applying; apply only when the delta is exactly the intended one.
- A provider's validate/dry-run endpoint proves the payload is well-formed, not that cross-service prerequisites hold — it can accept a config whose external authorization (an OAuth grant, an app installation) is missing. Verify prerequisites against the authoritative side directly (e.g. `gh api orgs/<org>/installations` for a GitHub App) instead of inferring them from a validation pass.

## Judgment stays at the top

- Design and adjudication are orchestrator-tier work. When the evidence under a design changes (stale reference, corrected spec), redo the design at the orchestrator tier — never hand the stale design down with a "re-verify your citations" instruction.
- Grounding priority when state or policy is uncertain: primary sources (git, live files, the actual spec) beat live skills, and live skills beat ledger notes or compacted memory. On a policy detail, the live skill file always wins over ledger shorthand.
- When parallel lanes independently invent shapes for the same shared surface, adjudicate one canon and give later-shipping lanes an explicit adopt-the-canon duty at rebase.
- Baseline breakage visible to the whole team invites parallel fixes: a human teammate may land their own while your fix lane runs. Re-fetch the base branch before landing yours — the first-merged fix is the canon. Drop your competing implementation at rebase and keep only the work that is orthogonal to it.
- Bank out-of-scope findings (with repro evidence) into a running list for a dedicated pass — never fix them inline, never drop them.

## Ledger discipline

- Structure the ledger as a **STANDING DIRECTIVES head** (settled policy, kept current) plus a chronological log. Reground after compaction from the head AND the tail — a tail-only reground lets settled directives fade.
- Record launches with their task/run ids, lanes with their base commits, and verdicts with their evidence.
- When a long effort concludes, externalize the durable record (decisions, divergences, audit results) to a permanent artifact — a GitHub issue or PR body — before the scratchpad is cleaned up.

## Recovery after an interruption

Step 0 is always to **positively enumerate what is alive** (task list, workflow roster) — a missing state file or empty output file usually means still-running, not dead. Declaring a live task dead and relaunching into its worktree corrupts both. Subagents and workflow agents run inside the harness, not as their own OS processes — `ps`/`lsof` silence proves nothing about them. Liveness evidence is the agent's transcript under the session's `subagents/` directory: a recent mtime or growing line count means alive. Until death is positively established, never mutate anything the agent shares — its dev server, database, ports, tokens, or worktree. Then, for tasks with positive evidence of death:

- Audit the worktree first: `git status`/`git log`. Clean tree at a known commit → relaunch the charter unedited. Dirty tree → launch a continuation agent on the same worktree whose first step is diffing working tree vs last commit to classify done/partial/untouched, then finishing — never a blind restart.
- A QA agent killed mid-mutation-proof can leave deliberately broken code on disk — check for a live mutation before anything else runs there.
- An agent that is still addressable resumes by message from its last checkpoint, keeping its context, instead of restarting cold.
- Probe returned capacity by attempting real work. Never idle-wait.

## Shipping and merging a lane

- The Definition of Done is a checklist, not an execution order. Open the PR the moment the fast gates (lint, tsc, unit) pass, and let CI run the E2E suite while agent-browser and mobile verification proceed locally. Never serialize gates that can overlap.
- Run independent fast gates concurrently rather than one after another.
- Write every PR title and description for an external reader: someone with zero knowledge of the execution that produced the change must understand what it is and why it matters. No orchestration vocabulary (goals, lanes, charters, sanctioned allowances, finder/verifier counts, workspace skills or tooling-repo names), and no superseded project state — describe what the change IS in the product's own terms, and rewrite the body as the work evolves so it always reads as current truth, not history.
- Before rebasing, predict the conflict surface: intersect the lane's touched files with what main gained since the lane's base. Empty intersection → expect a clean rebase; non-empty → you know exactly which files need care.
- Run rebase and post-rebase gates as separate, individually-checked steps — a chained command can swallow a mid-rebase conflict's exit code.
- Scripted conflict resolution (a keep-both re-append and the like) runs only after positively confirming the conflict exists (`git status` shows `UU` for that file). A rebase that auto-merged cleanly followed by a blind resolution script silently duplicates content — and the duplicate can still pass every gate. Count the merged entries against the expected total either way.
- After rebasing an approved commit, run a **patch-identity check**: diff the rebased patch against the approved patch (sorted added/removed line sets). A rebase is itself a mutation risk — a failed automated edit can commit conflict markers, and only an identity check catches it. The line-set comparison has a blind spot: a structural omission whose text recurs elsewhere in the diff — a dropped closing brace, a missing field in a merged literal — passes it, so the post-rebase gates remain the proof of correctness, never the identity check alone.
- When two open PRs both carry migrations, the second to merge must re-rebase and regenerate types from a freshly migrated database after the first lands — git can auto-merge a semantically wrong `types.d.ts`. When two lanes touch the same seam, merge the larger diff first and let the smaller one absorb the rebase.
- Watch CI with `gh pr checks <n> --watch` (exit code as verdict, not parsed text). Before merging, do one fresh direct `gh pr checks` read — never merge on a monitor's word, monitors die on network timeouts and carry parsing bugs. `gh run watch --exit-status` is equally untrustworthy in both directions: it has exited 0 while the job it watched had failed, and exited 1 while the run was still in progress — after any watch ends, read the run itself (`gh api repos/<owner>/<repo>/actions/runs/<id>`) before acting on its verdict.
- CI takes ~45 seconds to register a run after a push, so an immediate `gh pr checks` reads "no checks reported" from the previous run's absence and a chained push→watch→merge command silently skips the merge. Push, wait, then watch as three separate steps — never chain them. A branch can also register no run at all — a PR opened after its only push has sat idle with zero workflow runs — so before watching, confirm one exists (`gh run list --branch <branch>`); a fresh push re-triggers the event, and when there is nothing new to push, closing and reopening the PR re-fires the `pull_request` event without touching history. After any merge attempt, fresh-read the PR state (`gh pr view <n> --json state`); a skipped or failed merge otherwise leaves the PR OPEN unnoticed.
- Tear down a lane's worktree only after that fresh read confirms MERGED — never chain teardown onto the merge command. A merge can be rejected after its checks pass (a stale head branch, a base that moved), and a rejected merge with the worktree already gone forces recovery through a server-side rebase or a rebuilt worktree.
- This repo requires a PR's head branch to be up to date with the base before it can merge. When a merge is rejected for a stale head branch, run `gh pr update-branch <n> --rebase`, wait ~45s for the fresh CI run to re-register, fresh-read the checks, then merge.
- After any `gh pr update-branch --rebase`, the remote branch is a rewritten lineage: the local checkout's commits are superseded duplicates, so `git pull` there creates a merge of both lineages and the next local rebase replays every commit twice, conflicting with itself. To work locally after a server-side rebase, `git fetch` and `git reset --hard origin/<branch>` first — never pull-merge. Run the patch-identity check after, same as any other rebase.
- A "failed" CI job with no step concluding `failure`/`cancelled` (check `gh api .../jobs`) is infrastructure death — rerun it. A job with a real failing step is investigated before anything merges.
- Prepared-ahead scripts (placeholders patched at launch) keep the pipeline saturated, but audit a prepared script's content immediately before launching it — staleness there has shipped wrong charters.
