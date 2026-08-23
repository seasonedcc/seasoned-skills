---
name: worktrees
description: Run parallel tasks in isolated git worktrees, one per workspace repo being changed, provisioned by the setup/teardown scripts (env files, databases, ports for product-monolith). Use when creating or removing worktrees, running parallel tasks or agents, starting a dev server for a specific lane, or when the user mentions worktree, parallel lanes, or isolated environments.
---

# Worktrees

Each worktree is an isolated checkout of one workspace repo, so parallel tasks never share uncommitted state. Worktrees are always created from a specific nested repo — never from the workspace root (the root repo only carries the Claude Code setup; there is nothing to build there). For `product-monolith`, the setup script also provisions per-lane databases, a per-lane Redis database index, and a per-lane dev-server port, so dev servers and test runs can run concurrently across lanes.

## Lifecycle

### Create

From the workspace root:

```bash
bash .claude/skills/worktrees/scripts/setup.sh <repo> <lane>
bash .claude/skills/worktrees/scripts/setup.sh <repo> <lane> --branch feature/name   # custom branch (default worktree/<lane>)
bash .claude/skills/worktrees/scripts/setup.sh <repo> <lane> --base origin/main      # custom base (default origin's HEAD branch)
bash .claude/skills/worktrees/scripts/setup.sh <repo> <lane> --skip-provision        # worktree only, no deps/databases
bash .claude/skills/worktrees/scripts/setup.sh <repo> <lane> --skip-seed             # provision and migrate, but leave the databases empty
```

`<lane>` is a short lowercase slug naming the task (e.g. `fix-webhook-retry`). Setup is idempotent: re-running reuses the registered worktree, its databases, its port, and its Redis index — the managed env block is the allocation record, read back before anything is assigned — and rewrites that block in place. Only a lane whose databases setup creates in that same run is seeded, so re-running never writes over the data a lane already holds. It prints a summary with the lane's path, branch, databases, ports, and whether the lane was seeded.

What setup does per repo:

- **Every repo**: creates the worktree at `<repo>-worktrees/<lane>` (inside the workspace root, where the root gitignore already ignores it), branching from the repo's default branch, and copies gitignored `.env`/`.env.test` files from the main checkout.
- **product-monolith**: creates `.env` from the main checkout (or `contrib/env-sample`), rewrites `DATABASE_URL`, `DATABASE_MESSAGE_URL`, `REDIS_URL`, and `CELERY_URL` in a managed block to lane-specific values derived from the main checkout's own URLs, creates both lane databases empty on that same Postgres server, runs `uv sync --frozen`, and migrates both databases. A lane whose two databases were both created in that run is then seeded with `make seed`, so its data is the development seed's — never a copy of whatever the main checkout happens to hold. The seed is skipped, with the reason printed and carried into the summary, when either database already existed, when `--skip-seed` is passed, or when the branch's Makefile has no `seed` target. Starts the repo's docker compose Postgres/Redis only when nothing is already serving those ports — the machine may run its own — and polls the server until it answers before touching it.
- **engine-fork**: `yarn install`.
- **redirect-service / ingest-lambda-a / ingest-lambda-b**: creates `.venv` and installs the repo's requirements.
- **k3s-gateway / integration-lambdas**: nothing to provision globally (Go builds anywhere; lambdas install per lambda directory).

### Work

Everything runs from inside the worktree directory with the repo's usual commands — the worktree's `.env` carries the isolation:

```bash
cd product-monolith-worktrees/<lane>
uv run python manage.py runserver <DEV_SERVER_PORT>   # the port is in the .env managed block
make celery                                           # Celery against this lane's Redis index
make test                                             # pytest against test_product_worktree_<slug>
```

To read a lane's assignments later:

```bash
grep -A 6 'managed by the worktrees skill' <worktree>/.env
```

### Browser testing

Point agent-browser at the lane's dev-server port, and use one agent-browser `--session` per lane so cookies never mix:

```bash
agent-browser open http://localhost:<DEV_SERVER_PORT>/ --session <lane>
```

### Teardown

```bash
bash .claude/skills/worktrees/scripts/teardown.sh <repo> <lane>            # refuses if the worktree has uncommitted changes
bash .claude/skills/worktrees/scripts/teardown.sh <repo> <lane> --force    # removes anyway
```

Teardown kills processes listening on the lane's managed port, flushes the lane's Redis database (setup also flushes a freshly allocated index, so a recycled index never leaks a previous lane's keys or queue backlogs), drops the lane's full database family (dev, message, the `_e2e` pair, and every `test_`/xdist `_gwN` clone derived from them), and removes the worktree. It never touches the branch (it may back a PR).

## A worktree the user drives

A lane can be handed to the user for manual testing. From then on the tree is the user's: touch only what was explicitly delegated — typically keeping the lane current and its dev server running.

The handback protocol, every time new work merges into the lane's branch:

1. `git fetch origin` and fast-forward the lane. If the tree is dirty or the branch has diverged, stop and surface it instead of forcing it current.
2. Sync dependencies (`uv sync --frozen` in product-monolith), then `make migrate` — both databases.
3. Restart the dev server by the exact PID recorded in the lane's pid file (the file holds a plain number and nothing else, so a restart never has to guess which process is the lane's).
4. Verify the server answers, then tell the user the lane is ready.

When the sync renames migration files — a lane renumbering its migrations — a long-lived database migrated under the old numbering fails the migrate with `column ... already exists`: the renamed migrations are unrecorded, but the columns they add are already there. Diagnose with `git diff --name-status <old>..<new> -- '**/migrations/*.py'` (the `R` entries are the renames) read against the `django_migrations` table, then `migrate --fake` exactly the renamed set and run the real `migrate` for the rest. A database the user is driving is the user's state: ask before mutating it, a `--fake` included.

## Naming and isolation model

| Resource | Convention | Example (lane `task-a` on product-monolith) |
| --- | --- | --- |
| Worktree directory | `<repo>-worktrees/<lane>` | `product-monolith-worktrees/task-a` |
| Branch | `worktree/<lane>` | `worktree/task-a` |
| Dev database | `product_worktree_<slug>` | `product_worktree_task_a` |
| Message database | `product_worktree_<slug>_message` | `product_worktree_task_a_message` |
| Test databases | `test_` + the above (pytest-django) | `test_product_worktree_task_a` |
| Redis/Celery | `REDIS_URL`/`CELERY_URL` with a per-lane db index (1–14) | `redis://localhost:6379/7` |
| Dev server | `DEV_SERVER_PORT` in `.env` | 8100+ |

Ports and Redis indexes start from a deterministic hash of the lane slug; ports are then probed for availability and Redis indexes are allocated against the indexes sibling lanes' env files already claim. Once assigned, both live in the managed block and survive re-runs. The main checkout keeps its defaults — lane isolation lives entirely in the worktrees' gitignored env files, and the main checkout's `.env` (or `contrib/env-sample`) is the source of truth for where Postgres and Redis live on this machine.

Shared across lanes (by design): the local Postgres server, the local Redis server (isolation is by database index), the uv/yarn caches, and any external service credentials copied from `.env`. Anything a lane does against external services is visible to other lanes. Database contents are not shared: each lane's databases are created empty and seeded, so nothing a lane writes — and nothing the main checkout holds — reaches another lane.

## Guardrails and gotchas

- When the task's base is anything other than the repo's default branch (a goal's feature branch, a release branch), pass `--base` explicitly — setup defaults to the default branch, and a lane provisioned off the wrong base looks healthy until its diff or its databases lie. `--base` only applies when setup creates the branch: an existing branch is checked out as-is (setup fast-forwards it when it is strictly behind its origin counterpart, and prints a warning when the two have diverged or when an explicit `--base` is being ignored). Verify the `base` shown in setup's final summary — and for a lane on a pre-existing branch, that the worktree's HEAD matches the origin tip you expect — before using the lane.
- NEVER run `git stash` inside a worktree. The stash is one stack shared by the main repo and every worktree, so a concurrent lane's push/pop can silently swap or drop another lane's uncommitted work. To shelve work, use `git diff > <file>.patch` (restore with `git apply`) or a WIP commit.
- Run at most TWO full `-n auto` test suites concurrently across all lanes. Four at once exhausted the shared Postgres server's connection slots (`FATAL: remaining connection slots are reserved`), poisoning every in-flight gate with hundreds of phantom errors. CI is the authoritative parallel gate; locally, queue the rest. That allowance is for suites in *different* lanes: never run one lane's `-n auto` suite and its e2e stack concurrently — same-lane contention has killed an xdist worker mid-run (`mainloop: caught unexpected SystemExit!` at 88%). An xdist worker death with zero test failures is a contention symptom, not a verdict on the code — other projects on this machine share the same CPU and Postgres server, so read the host's load average before concluding anything, and lower `-n` rather than re-running the identical command. External workloads count against the two-suite allowance: when the host is loaded well beyond its cores by work that is not yours, even a compliant pair of suites can be killed by system pressure — the signature is near-simultaneous background-task kills with zero failures in the logs. Then run one lane's gates at a time in a single chained background task with `PYTEST_MAX_WORKERS` lowered (4 worked), waiting for the 1-minute load average to drop below a threshold before each suite, and never reclaim the host by killing processes you do not own. A Hypothesis `FailedHealthCheck` (`too_slow`) failure under parallel load is the same class of signature — the host was starved, not the code broken: rerun exactly the failing tests in isolation before treating them as real, and reconcile the totals.
- Never run a lane's e2e suite and an agent-browser QA session concurrently in the same lane: both claim the lane's single `DEV_SERVER_PORT` — `e2e/run.py` starts its own server stack on it, and browser QA needs the lane's dev server listening on it — so the two runs collide on the port. Sequence them, or give the browser QA its own lane.
- The per-lane Redis index pool is 1–14 and exhausts silently around fifteen provisioned lanes. Tear down finished lanes between waves — teardown frees the lane's Redis index, databases, and port for the next wave.
- Read-only work — audits, reviews, censuses — gets its OWN worktree, never a build lane's tree; `--skip-provision` makes it cheap. And before ANY teardown, check the live task/agent roster for agents still reading that tree: a teardown under a live reader corrupts the reader's run.
- Run post-merge routines (pull, dependency install, migrate, baseline tests) only from the main checkout — inside a worktree, `make migrate` and `make seed` hit the lane's isolated databases, and run from the main checkout they hit the main development databases. Always include the dependency install: a merged PR can add a dependency, and tests can stay green while the app fails on the missing module.
- Pushes from a lane always name an explicit refspec (`git push origin HEAD:worktree/<lane>`). Never rely on a bare `git push`: the lane branch's upstream is not necessarily the lane branch, so a bare push can aim at the base branch or fail in a way that looks like the push succeeded.
- Push each successive slice of a lane under a fresh remote branch name instead of force-pushing over an already-merged tip.
- If a configured port is already bound, never kill the listener to reclaim it — it may be a sibling lane's live server. Re-run setup (it probes for a free port) or start on a different free port. The exception is your own lane's zombie process — find it with `lsof -iTCP:<port>` and kill it.
- Teardown only ever drops databases named `product_worktree_*`/`test_product_worktree_*`, and only kills port listeners that run from inside the lane's own worktree. The main development databases and sibling lanes' servers can never be collateral.
- Never edit the main checkout's `.env` from a worktree task; each worktree owns its own copy.
- The managed block in lane env files is marked with `# --- managed by the worktrees skill (per-lane isolation) ---`. Its presence is the idempotency sentinel — do not remove it by hand.
- After rebasing a long-lived worktree onto main, diff the repo's env surface (`contrib/env-sample` in product-monolith) against your lane's base commit — a newly-required env var must be mirrored into the worktree's gitignored `.env` or the dev server and tests crash.
- Implementation lives in `scripts/` next to this file (`common.sh` holds the shared helpers; `setup.sh`/`teardown.sh` are the entry points, both idempotent).
