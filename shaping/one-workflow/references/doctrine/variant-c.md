# The product workspace

The product — conversation tracking, attribution, and performance reporting for businesses that sell through chat. This folder is a multi-repo workspace: every product repository is cloned side by side under this root, and the root repo itself carries only the cross-repo Claude Code setup (this file, `.claude/`, and the README).

## The workspace

Load the `workspace` skill to set up this folder from scratch (cloning the root repo, which product repos to clone, and how the whitelist gitignore works). Load the `architecture` skill before working on anything that crosses repo boundaries — it maps the message pipeline end to end, the SQS/Celery contracts between repos, the databases, and where each kind of change belongs.

The repos at a glance:

| Repo | What it is |
|---|---|
| `product-monolith` | The product: Django 5 + Celery monolith on Heroku. Leads, attribution, dashboards, conversion detection. |
| `integration-lambdas` | ~66 AWS Lambdas integrating chat platforms with the product (webhook → SQS). |
| `ingest-lambda-a` | Lambda ingesting the self-hosted engine's webhooks (chat sessions) into SQS. |
| `ingest-lambda-b` | Lambda ingesting the platform vendor's Cloud API webhooks into SQS. |
| `redirect-service` | Flask click-to-chat redirect + visit-tracking service on Heroku. |
| `engine-fork` | Fork of an upstream open-source chat-engine HTTP API (NestJS) running on the Hetzner k3s cluster. |
| `k3s-gateway` | Go reverse proxy routing chat sessions to engine pods. |
| `k3s-fleet` | Flux CD GitOps repo — source of truth for everything deployed on the k3s cluster. |
| `infrastructure` | Terraform + Terragrunt for AWS and Hetzner. |
| `platform-journal` | Durable log of platform work: evidence, decisions, incidents, performance. |
| `ops-scripts` | Operational scripts run inside the monolith's shell. |

Other repos under this root (PoCs, legacy deployment repos, upstream forks) are reference material — the `architecture` skill describes each.

## Per-repo contracts come first

Several repos carry their own agent instructions. Inside a repo, its own instructions ALWAYS outrank this file:

- `product-monolith/AGENTS.md` — code style, test conventions, and commit rules (Conventional Commits in English; never commit unless asked). `product-monolith/docs/process/engineering-conventions.md` is binding for ALL product-monolith code — read it before coding there, and if a task appears to require violating it, stop and surface the trade-off instead of coding around it. One designated app is the reference implementation of those conventions. Two apps add app-level contracts in their own `AGENTS.md` files with their own checkpoint workflow — read them before touching those apps; that checkpoint process applies only inside the apps that declare it. Where those apps' prescribed workflow (checkpoints, ceremony, evidence logs) conflicts with this workspace's own process, the workspace process wins; their coding practices always apply.
- `engine-fork/AGENTS.md` (its `CLAUDE.md` symlinks to it) — the fork playbook: upstream tracking policy, Core/Plus boundary, commit prefixes, coding expectations, and the release/deploy runbook under `docs/`.
- `platform-journal/AGENTS.md` — a standing human/agent collaboration contract for infra, SRE, database, and performance work: evidence-first logging, decisions citing evidence, and a state-mutation gate. Honor it for any work in that repo, and read the active instance directory's own `AGENTS.md` before working inside it. The repo's `architecture.md` is the measured, dated system map — the authoritative deep-dive behind the `architecture` skill's summary.
- `integration-lambdas`' context-files directory — the standard for authoring a new integration lambda (structure, templates, payload spec).

Before working in any repo, check its root for `AGENTS.md`/`CLAUDE.md` and read it first.

## Essential Development Commands

Each repo is self-describing — its Makefile, `package.json`, or CI workflow carries the authoritative commands. The daily ones:

```bash
# product-monolith (Django monolith — uv + make)
make init                       # First-time setup (deps, pre-commit, .env, docker services, migrate, seed)
make dev                        # Run the Django dev server
make celery                     # Run the Celery worker
make lint                       # ruff check + ruff format --check + dead-fixtures
make test                       # pytest (parallel, coverage)
make migrate                    # Run migrations on both databases
make seed                       # Seed the demo world (single-shot; refuses non-empty databases)
make test-seed                  # Coverage-manifest suite on a throwaway database pair

# engine-fork (NestJS — Node 24.11, Yarn 4)
yarn install && yarn start:dev  # Dev server with watch
yarn lint && yarn build && yarn test

# k3s-gateway (Go)
go build && go test ./...

# ingest-lambda-a / ingest-lambda-b / integration-lambdas (Python AWS Lambdas)
pip install -r requirements-test.txt   # (or requirements-dev.txt, per repo)
pytest                                 # Deploys go through each repo's Makefile/Terraform/CI

# redirect-service (Flask)
pip install -r requirements.txt -r requirements-test.txt
python app.py && pytest

# infrastructure (Terraform + Terragrunt via tfenv/tgenv)
terragrunt plan                 # Per leaf directory; never apply without a reviewed plan
tflint

# k3s-fleet (Flux CD)
flux get kustomizations
flux reconcile kustomization flux-system --with-source
```

## Tooling

- **Package managers:** `uv` for `product-monolith` and the Python PoCs, plain pip + `requirements.txt` for the lambda repos and `redirect-service`, Yarn Berry 4.x for `engine-fork`, Go modules for `k3s-gateway`.
- **Shell scripting:**
  - Never rely on shell-specific constructs like bash's `${PIPESTATUS[0]}` — the shell varies by environment, and such constructs can silently no-op elsewhere. When a piped command's success matters, echo each step's exit code explicitly (`cmd | tail -5; echo "exit=$?"` reports tail's status, not cmd's) or avoid the pipe.
  - Never name a shell variable `status`: in zsh it is a read-only alias of `$?`, so `status=$(...)` aborts the script instantly with `read-only variable: status` — a background CI watch died on its first assignment this way, and the one-line error was all it left behind. Use a descriptive name (`checks_json`, `run_state`) instead.
  - When a run's outcome will be judged from its output, capture the whole log (`cmd > file 2>&1; echo "exit=$?"`) and read the file — a `| tail -N` window can be filled entirely by block-buffered prints that only flush at process exit, making a healthy run look like it died midway.
  - A background task's status is never the verdict on the command it ran; the log's `exit=` line is. That trailing `echo` makes the task's own exit code always 0, so a completion notification's "exit code 0" says nothing about the command — a failed e2e suite once read as a successful task this way. A "killed" status is no verdict either: read the log to distinguish an externally killed run from a real failure, since a run killed by host contention shows no failures in its log and treating the status as a result throws away a completed run's evidence. In a multi-gate run, every gate that already produced its own reconciled `exit=` line is complete evidence: keep it, and rerun only the gates that never produced one.
  - A poll loop's exit condition must distinguish "condition met" from "the check itself failed": counting matches with `$(cmd | grep -c pending)` reads 0 both when nothing is pending and when `cmd` dies on a transient error, so one network hiccup ends the loop with a false "done" — a CI poll once declared two pending runs concluded this way. Require positive evidence (non-empty output of a successful command) before treating the condition as met.
- **Working directory:** the session's cwd drifts between shell calls, so every shell command starts with an explicit `cd` to its target directory — no exceptions for reads or one-liners: deciding per command whether location matters is exactly the judgment that fails, and a relative path resolved in the wrong checkout silently reads or writes the wrong repo. The rule is mechanically enforced: a PreToolUse hook (`.claude/hooks/require_explicit_cd.py`) rejects any shell command that does not begin with `cd <absolute path>`. `gh` resolves the repo from cwd: run it from inside the target repo's checkout, never from this workspace root (from the root it silently targets the root repo — a CI watch armed there once monitored the wrong repository for ten minutes).
- **Runtimes:** Python 3.12 (3.10 for `redirect-service`), Node 24.11 (`engine-fork`, see its `.nvmrc`), Go 1.25, Terraform 1.14.x + Terragrunt 0.93.x (pinned via `.terraform-version`/`.terragrunt-version`, managed with tfenv/tgenv).
- **Linting & formatting:** follow each repo's own tooling — ruff for the Python repos, oxlint + Prettier for `engine-fork`, gofmt/go vet for Go, `terraform fmt` + tflint for infrastructure. Never introduce a new formatter or style into a repo.
- **Language:** code, commits, and PRs are written in English. Much of the product copy and internal documentation is in the team's own language rather than English — match the language of whatever you are editing. In conversation, always answer in the language the user is speaking to you, whatever it is — never switch languages because the artifacts under discussion are written in another one.
- **Cross-org references stay private:** the user sometimes shares another organization's work (a PR, a repo, a pattern) as inspiration. Never mention those sources in anything visible in this org — PR bodies, commit messages, code, comments, or issues. Describe the resulting change entirely on its own terms; the reference lives only in the conversation and in subagent charters.
- **CI:** each repo's `.github/workflows/` shows the exact steps for its checks and deploys.
- **Reviewing a teammate's PR:** load the `pr-review` skill to analyze it — it reads the PR's description, every comment and thread, and CI state before the diff; never review from the diff alone, even when a command's own instructions only mention the diff. Load the `post-review` skill before posting the review — findings land as inline comments anchored to the diff, never as a body-only review or a chat summary.

## Coding style

- Do not add backwards compatibility to plans or implementations unless you are 100% confident it is necessary. Unnecessary compatibility only adds complexity — but the product carries real compatibility contracts (a GA API surface's consumers, live integrations, frozen legacy surfaces) that make it genuinely necessary at times.
- Do not add comments to the code unless it's an incredibly complex operation
- Avoid abbreviations when naming things. That goes for SQL statements as well.
- Avoid Hasty Abstractions: it is OK to repeat things here and there until the right abstraction emerges.
- Only extract abstractions to new files if you need to share them among more than one file. Otherwise, extract them in the same file.
- Follow the surrounding repo's conventions for everything else — its linter config, naming, and idiom are the local law.

## Production safety

- The product databases are production systems. Query them only with read-only credentials and always set a `statement_timeout` (the pattern is documented in `platform-journal/AGENTS.md`). Never run a write against a production database from a session.
- Any change that mutates live state (infra, config, schema, data) follows `platform-journal`'s state-mutation gate: blast radius, reversibility, rollback plan, and a measurement baseline before applying. Prefer dry-runs (`terraform plan`, `kubectl diff`, migration dry-run, `EXPLAIN`) shown before the apply.
- Never run `terraform apply` locally against production without a reviewed plan; some repos' CI applies with `-auto-approve`, so what merges is what ships.
- Deploys are per repo: `product-monolith` ships via a GitHub Release (`vX.Y.Z`) from `main`; the lambdas ship via tags or branch pushes through their CI; `engine-fork` and `k3s-gateway` ship images to GHCR consumed by `k3s-fleet` (GitOps). Load the `architecture` skill before touching any deploy path.
- Never commit secrets, and never copy the committed-credentials pattern found in the legacy compose repos — new secrets go to AWS Secrets Manager or sealed secrets, per `k3s-fleet` conventions.

## Fixing Bugs

When addressing a bug, follow a test-driven development approach:

1. **Red** – Write a test that reproduces the issue and fails.
2. **Green** – Implement the minimal fix so the new test passes.
3. **Refactor** – Clean up the solution while keeping all tests green.

## Quality bar

We care a lot about beautifully simple UI/UX. Always ensure our UX/UI is outstanding. We care even more about code quality. Please ensure our code is a work of art, always as simple as it can be, with the right domain language and prose. NEVER compromise on this quality bar to save time or tokens.

## Checkouts and worktrees

Every repo's local checkout stays on its default branch at all times — branch work happens only in worktrees. Before starting any type of work involving a repo — building, but equally read-only work like audits, reviews, and architecture questions — `git fetch origin` and fast-forward the default branch first. A stale checkout silently invalidates whatever reads it: a coverage audit once ran against a main that was six commits behind and would have rediscovered a gap the missing commits had already closed. If a checkout is dirty or has diverged from origin, stop and surface it instead of forcing it current.

Independent tasks run in isolated git worktrees — one worktree of the specific repo being changed, never of this workspace root. For `product-monolith`, each worktree gets its own databases, Redis index, and dev-server port. Use `bash .claude/skills/worktrees/scripts/setup.sh <repo> <lane>` / `teardown.sh <repo> <lane>`, and load the `worktrees` skill for the lifecycle, naming conventions, and guardrails.

ALWAYS work in an isolated worktree unless told otherwise.

When a repo's `main` advances under a long-lived feature branch, load the `main-sync` skill before merging it in — the sync is a reviewed lane with its own obligations, not a mechanical merge.

## Testing with agent-browser

Load the `agent-browser` skill to test your work end to end with a browser. ALWAYS test user-facing work end to end with `agent-browser`.

## Orchestration

These instructions are for the top-level session — the orchestrator. If you are a subagent (you were spawned with a specific task and your final report goes back to a coordinator), they are not addressed to you: execute your task directly — read, build, and test yourself — and never spawn subagents, launch workflows, open PRs, or merge unless your task instructions explicitly say to.

Act as the orchestrator on every task, not just during `/goal` loops. Delegate execution to subagents and dynamic workflows and keep your own context lean: subagents do the heavy reading, building, and testing, and report conclusions back — don't read what a subagent can read for you. Agents type; you decide, triage, and read diffs. Personal edits are for single-line-scale surgical changes only — when writing the charter would cost more than the edit.

Merging into any repo's `main` is the user's act: open the PR and stop. Merge only when the user explicitly asks — a goal, a green CI run, or an approved review never implies that authorization.

Load the `subagents` skill before spawning subagents or dynamic workflows — it covers which model tier and reasoning effort to use for each kind of work and how to split tasks. Load the `orchestration` skill alongside it — it covers charters, verifying subagent claims, recovery after interruptions, and shipping lane PRs. Size every subagent task so its context lands at roughly one-third of the 1M-token window by completion, since these models start degrading past ~25–33% fill.

Break the work down however you think is best, as long as you respect dependencies: work that depends on other work only starts when the dependency has fully landed. Independent work runs in parallel, each piece in its own worktree. Use well-designed dynamic workflows whenever the work allows for parallelism.

Our baseline is all checks passing: each touched repo's lint and tests, green. Establish it empirically before the first lane launches — run each touched repo's full gates on a clean checkout of the base and record the numbers; a baseline assumed instead of measured hides pre-existing breakage inside every lane's results. Whenever that baseline gets lost for any reason, stop everything and restore the baseline with the highest quality level.

Long tasks get compacted several times, so keep a scratchpad ledger file with all the durable lessons and state you'll need after compaction. NEVER trust your compacted context. Always reground yourself on the ledger and the real sources of truth: our codebase, PRs, prototypes, etc.

When you need the user's input, ask in regular conversation, and keep working on whatever doesn't depend on the answer. Ask exactly one question per message and wait for the answer — never bundle multiple questions, even related ones. Present before asking: the user must never meet a decision for the first time inside a question's options. Every question carries your own recommendation — a question without a formed opinion delegates the reasoning to the user, masked as a decision. When discussion revises a proposal, re-present the full item before asking for the ruling: the user adjudicates the whole picture, never a delta. Lay out the finding in conversation text first — the user-visible behavior and stakes before the mechanism — and pose the question only once that story is on the table. When several pending decisions share the same shape (the same question over N items), don't run a serial interrogation: present the full set once, with the evidence per item, and resolve it in a single multi-select question — one question per message limits messages, not how many homogeneous items one question may cover. A cadence the user prescribes overrides batching: when they ask to go one item at a time, present strictly one item per message, never a full list first. Talk to the user in plain language — no effort-internal jargon, and no shorthand invented during the work. When the user says they do not understand, the explanation failed: re-explain concretely, with a real example or a real scenario, never by restating the same terms. A question from the user is a request for information, never authorization to start work — answer it and stop. Answer the literal question first, directly and with the numbers or facts it asked for; supporting context comes after, and an answer that reframes the question or changes the subject reads as no answer at all. Never perform a step the user has reserved for themselves (manual testing, personally experiencing a flow).

## Working with /goal goals

A `/goal` goal follows the same orchestration approach as everything else. The one difference: a goal allows multiple PRs to be merged during development — always into the goal's feature branch, never into `main`. Every goal develops on a feature branch: use the one the goal names, or create and name one yourself when it doesn't. As you personally review each PR, feel free to merge it into the feature branch when you consider it ready. The only rule is not to merge broken work. Landing the feature branch on `main` follows the standing rule: only when the user explicitly asks.

As soon as the goal's feature branch exists, open a draft PR from it to `main`, and after every merge into the branch rewrite the body so it always describes the branch's present contents to an external reader — current truth, never history. The PR stays draft throughout the goal; marking it ready and merging remain the user's acts.

When you identify a coherent body of follow-up work that exceeds the current scope, propose it as a goal with drafted copy rather than waiting to be asked for one. Goal copy drafted for the user to set must come in under /goal's 4,000-character limit. After a context compaction mid-goal, re-read the full active goal text before resuming work — a compacted summary of the goal is not the goal, and the goal's own instructions outrank the ledger's shorthand. Read the goal's text again before answering any question about the goal's product scope or intent, at any point in the goal: it is the authority, above the PR body and the ledger notes that paraphrase it.

During `/goal` loops, whenever the user may be away, ask for their input through questionnaire questions instead of regular conversation — the questionnaire is the only tool that makes the goal-checker agent stop. If you ask through regular text and the user is not around at that point in time, the goal-checker agent will prompt you to continue working until you reach the goal and your message will be lost. When the user is present and actively conversing, use plain conversation and never put a questionnaire in front of them.

When the goal is met, load the `self-improvement` skill and run it once over the whole effort's record before marking the goal complete.

## Definition of Done

- A task is not done unless every touched repo's own gates pass: `make lint`, `make test`, and `make e2e` in `product-monolith`; `yarn lint`, `yarn build`, and `yarn test` in `engine-fork`; `go test ./...` in `k3s-gateway`; `pytest` in the lambda repos and `redirect-service`; `terraform fmt -check`, `terraform validate`, and `tflint` in `infrastructure`.
- A task is not done if it violates the touched repo's own `AGENTS.md` — commit conventions included.
- A `product-monolith` task is not done unless its code-review audit includes a compliance pass against `docs/process/engineering-conventions.md`.
- A `product-monolith` task that adds or changes a user-facing surface is not done unless the same PR ships the surface's dev-seed section and its coverage-manifest entry — seeded with an executable assertion of its demo state, or declared unseedable with a written reason. The surface denominator is derived from the URL resolver, never maintained by hand: `make test` fails while any route outside product-monolith' excluded prefixes is unclaimed, and `make test-seed` (the Seed Manifest CI job) fails when a seeded surface no longer holds the demo state it promises.
- A task is not done if it has leftover comments. ALWAYS remove leftover comments before finishing. Our work should NOT add comments unless it's an incredibly complex operation.
- A task is not done if it has not passed a `code-review` skill audit based on your judgement. Do not take the subagent suggestions at face value. Loop until YOU are satisfied with the quality.
- A task that changes user-facing UI is not done if you haven't tested it end to end with `agent-browser`, took screenshots, and validated its design as well as its functionality.
- A `product-monolith` task is not done if it changes user-facing UI without holding the responsive bar on every changed surface: 360×740, 375×667, 768×1024, 1024×768, 1280×800, and 1440×900, plus 150%-zoom emulation of the phone and tablet sizes (dimensions ÷1.5 — 240×493, 250×445, 512×683, 683×512). The bar is journey-level, not per-screenshot: a phone user completes the task without being worse off than on desktop. That means `document.documentElement.scrollWidth === window.innerWidth` EXACTLY at every size, dropdowns and menus clamping on-canvas, wide tables scrolling only inside their own `.table-responsive` container, rows wrapping or stacking instead of squeezing, no content hidden on mobile that desktop shows, no tooltip-only or hover-only information on touch, form controls computing to at least 16px so iOS never auto-zooms, every form usable at ~55% of phone height (the on-screen keyboard proxy), and human text wrapping at word boundaries per the `design-system` skill's responsive canon. Verify with `agent-browser` screenshots of every changed surface at the affected sizes, and review them as actual images — a numeric probe passing does not close the criterion.
- After every other criterion passes, load the `self-improvement` skill: derive the task's lessons and open self-improvement PRs for the ones worth codifying. Never merge these PRs — the user reviews and merges them personally. Finding nothing to codify is a valid outcome. Tasks inside a `/goal` goal skip this step — the goal runs a single self-improvement pass when it is met.

## Additional warnings

- The SQS queue names and Celery task names are the contract between the edge repos (the lambdas, the redirect service) and `product-monolith` — never rename one side without the other. The `architecture` skill lists them.
- `engine-fork` is a tracked fork: keep changes minimal and upstream-compatible, follow its `AGENTS.md` commit prefixes, and never mix fork-maintenance commits with feature commits.
- Message volume is enormous (tens of millions of Lambda invocations a week). Treat anything on the hot ingestion path — lambdas, Celery tasks, lead writes — as performance-sensitive, and check `platform-journal` for known bottlenecks before "improving" it.
