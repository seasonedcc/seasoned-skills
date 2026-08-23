---
name: worktrees
description: Run parallel tasks in isolated git worktrees, each with its own databases, ports, env files, and dev server. Use when creating or removing worktrees, running parallel tasks or agents, starting a dev server for a specific worktree, running browser tests against an isolated server, or when the user mentions worktree, parallel lanes, or isolated environments.
---

# Worktrees

Each worktree is a fully isolated copy of the app: its own git checkout, its own development and test databases on the shared local Postgres, its own ports, and its own maildev. Parallel tasks never share state, so dev servers, unit tests, E2E tests, and browser sessions can run concurrently across worktrees.

## When a task does not need one

A documentation-only change — every file in the diff is markdown, or `ci.yml` (the definition lives in CLAUDE.md § Definition of Done) — uses none of this isolation: no database, no ports, no dev server. Run it on a branch off the main checkout and skip `worktree:setup` entirely. If the main checkout is dirty or holds another lane's branch, a plain `git worktree add ../app-worktrees/<lane> -b <branch> origin/main` gives an isolated checkout in seconds with no provisioning; remove it afterwards with `git worktree remove`. The moment the diff grows beyond markdown (or `ci.yml`), provision a real lane.

## Lifecycle

### Create

From the main checkout (or any worktree — the scripts resolve the main repository):

```bash
pnpm run worktree:setup <lane>
pnpm run worktree:setup <lane> --branch feature/name   # custom branch (default worktree/<lane>)
pnpm run worktree:setup <lane> --base origin/main      # custom base (default origin/main)
pnpm run worktree:setup <lane> --skip-seed             # unseeded development database
pnpm run worktree:setup <lane> --fresh-seed            # reseed the template so the demo data lands on today
```

Setup is idempotent: re-running reuses the registered worktree, its ports, and its databases. It prints a summary with every port and database name. Claude Code's `WorktreeCreate`/`WorktreeRemove` hooks (wired in `.claude/settings.json`) run the same scripts automatically for harness-created worktrees.

What setup does: creates the worktree at `../app-worktrees/<lane>` from `origin/main`, copies `.env` and `.env.test` from the main checkout and rewrites the managed keys, starts `pnpm install` in the background, and provisions both databases by copying the template databases described below. With current templates a lane lands in a handful of seconds, and the install is what dominates.

### Template databases

Migrating and seeding a database from scratch costs around twelve seconds, so setup copies two global template databases instead:

| Template | Contents |
| --- | --- |
| `app_template_development` | migrated and fully seeded — the source of every lane's development database |
| `app_template_test` | migrated only — the source of every lane's test database, and of a `--skip-seed` development database |

Each template carries a fingerprint in its `COMMENT ON DATABASE`: hashes of the migration and seed sources plus the date the seed ran. Setup compares that fingerprint with the lane's own sources and decides:

- everything matches → copy the template;
- only the migrations moved on → copy, then run `db:migrate:production` on the copy; if that fails (the template is ahead of the lane's branch) the lane falls back to creating, migrating and seeding from scratch;
- the seed changed, or the template is missing → rebuild the template from the lane's sources under a Postgres advisory lock, then copy it;
- only the seed date is stale → copy anyway and warn. The demo data is anchored to the day the seed ran, so appointments and visits land on the template's build date instead of today. Refresh it with `pnpm run worktree:template`, or set the lane up with `--fresh-seed`.

```bash
pnpm run worktree:template           # rebuild whatever is stale
pnpm run worktree:template --force   # rebuild both templates unconditionally
```

The command builds from the checkout it runs in, so run it from the main checkout unless you deliberately want a branch's seed in the template. Templates are shared by every lane and are never dropped by teardown.

### Refreshing a lane's development database

A lane's development database is a template copy, so demo content the lane's own branch adds to the seed is not in it — a card, panel, or customer your feature seeds will be missing until the lane reseeds. Re-running `worktree:setup` is not the fix: with the lane's seed sources changed, setup rebuilds the *shared* template from the branch and leaks unmerged demo content into every future lane. Refresh the lane locally instead — stop whatever holds connections (dev server, worker), then:

```bash
dropdb <lane's development database> && createdb <same>
pnpm run db:migrate && pnpm run db:seed:dev   # from the lane's root
```

### Work

Everything runs from inside the worktree directory with the usual commands — the worktree's `.env` files carry the isolation:

```bash
cd ../app-worktrees/<lane>
pnpm run dev          # dev server + maildev on this worktree's ports
pnpm run dev:worker   # graphile-worker against this worktree's database
pnpm run test:unit    # resets and migrates only this worktree's test database
pnpm run build && pnpm run test:e2e   # E2E needs a build first (test server runs the production build)
```

Harness-tracked background shell tasks are killed roughly an hour after their owning agent's turn ends, and `nohup … & disown` from a shell tool call is no safer — the process dies with the tool call's process group (observed as a SIGTERM taking down a lane's dev server mid-session). Any process that must outlive a turn — a dev server, `dev:worker`, Metro, an emulator — needs a real double-fork into its own session. Write this helper to the scratchpad once and start every long-lived process through it (servers started this way have survived across multiple agents' turns):

```python
import os
import sys

cwd, log, cmd = sys.argv[1], sys.argv[2], sys.argv[3:]
if os.fork() > 0:
    os._exit(0)
os.setsid()
pid = os.fork()
if pid > 0:
    print(pid, flush=True)
    os._exit(0)
out = open(log, 'ab', 0)
os.dup2(out.fileno(), 1)
os.dup2(out.fileno(), 2)
devnull = open(os.devnull, 'rb')
os.dup2(devnull.fileno(), 0)
os.chdir(cwd)
os.execvp(cmd[0], cmd)
```

```bash
python3 <scratchpad>/detach.py <worktree>/apps/web /tmp/<lane>-dev.log pnpm run dev
python3 <scratchpad>/detach.py <worktree>/apps/web /tmp/<lane>-worker.log pnpm run dev:worker
```

Launch detached servers from `apps/web`, never from the worktree root: the root `dev` script wraps Turborepo, and a turbo-wrapped task shuts itself down ("Shutting down Turborepo tasks…") roughly 90 seconds after its session detaches, even under `setsid`. `apps/web`'s own `dev` starts the same processes without turbo — server plus maildev — so nothing is lost by skipping the root script, and running `dev:worker` from the same directory keeps the pair consistent.

Detached processes survive the Claude session that started them, so a `SessionEnd` hook (wired in `.claude/settings.json`) kills every node/pnpm/turbo process whose working directory is inside a lane when the user quits Claude at the prompt or logs out. Every other end — `/clear`, `/resume`, headless (`claude -p`) runs, window close, a hard kill — keeps processes, so orphans are still possible until the next clean quit sweeps all lanes. Expect lane servers to be gone after quitting Claude and restart them when resuming work. The sweep spares nothing lane-scoped: a parallel top-level session's servers and an editor's language servers for a lane die with it. To list and clean lane processes by hand:

```bash
pnpm run worktree:processes                        # list processes running in lanes
pnpm run worktree:processes --kill [--lane <lane>] # terminate them
```

The setup summary (and the worktree's `.env`/`.env.test`) tells you the ports. To read them later:

```bash
grep -A 10 'managed by scripts/worktree' apps/web/.env apps/web/.env.test
```

### Browser testing

Point agent-browser at the worktree's dev server port, and read emails from the worktree's own maildev REST API (login is passwordless, so magic links arrive there):

```bash
agent-browser open http://localhost:<PORT>/auth/email --session <lane>
curl -s http://localhost:<MAILDEV_WEB_PORT>/email | ...   # fetch the magic link
```

Use one agent-browser `--session` per worktree so cookies never mix.

Magic-link emails are sent by the worker, not the web process — `pnpm run dev` alone never delivers them. Start `pnpm run dev:worker` (detached, like the dev server) before requesting a login link, or maildev stays empty while the login form reports success.

### Teardown

```bash
pnpm run worktree:teardown <lane>            # refuses if the worktree has uncommitted changes
pnpm run worktree:teardown <lane> --force    # removes anyway
```

Teardown kills processes listening on the worktree's ports, drops both databases, and removes the worktree. It never touches the branch (it may back a PR). The `WorktreeRemove` hook does the same minus the directory removal (the harness handles that) and never blocks.

Before tearing down a lane that produced experiment artifacts — prototype apps, screenshots or other evidence, notes — copy anything worth keeping to a durable location first. Teardown deletes the worktree, and a finished agent's transcript is not a durable store.

## Naming and isolation model

| Resource | Convention | Example (lane `task-a`) |
| --- | --- | --- |
| Worktree directory | `../app-worktrees/<lane>` | `../app-worktrees/task-a` |
| Branch | `worktree/<lane>` | `worktree/task-a` |
| Dev database | `app_wt_<slug>_development` | `app_wt_task_a_development` |
| Test database | `app_wt_<slug>_test` | `app_wt_task_a_test` |
| Template databases | `app_template_development` / `app_template_test` | shared by every lane |
| Dev server / HMR | `PORT` / `HMR_PORT` in `.env` | 4100+ / 24700+ |
| Dev maildev SMTP / web | `MAILDEV_PORT` / `MAILDEV_WEB_PORT` in `.env` | 11100+ / 12100+ |
| Test server / maildev | same keys in `.env.test` | 5100+ / 13100+ / 14100+ |

Playwright filters match the full spec *path*, and a lane's path contains its name — so a lane named after its feature's spec files makes every filter match the whole suite (`pnpm run test:e2e -- exam-2-s` in a lane at `app-worktrees/exam-2-s` runs all specs, since each path contains `exam-2-s`). Name the lane so it is not a substring of any filter you will pass (`sc36` for a feature whose specs are `sc-36-*`).

Ports are spread deterministically by a hash of the lane slug, then probed for availability. The main checkout keeps its defaults (4002, 24680, 1027, 1082, `app_development`, `app_test`) — worktree isolation lives entirely in the worktrees' gitignored env files.

Shared across worktrees (by design): the local Postgres server, the pnpm store (installs are hardlinks, so they are fast), and external service credentials copied from `.env` (DigitalOcean Spaces, Stripe test keys, Google APIs). Anything a task does against those external services is visible to other worktrees.

## Guardrails and gotchas

- NEVER run `git stash` inside a worktree. The stash is one stack shared by the main repo and every worktree, so a concurrent lane's push/pop can silently swap or drop another lane's uncommitted work. To shelve work, use `git diff > <file>.patch` (restore with `git apply`) or a WIP commit.
- Run post-merge routines (pull, `pnpm install`, migrate, seed, baseline tests) only from the main checkout — inside a worktree, the branch tracks the lane ref and `db:migrate` hits the lane's isolated database. Always include `pnpm install`: a merged PR can add a dependency, and unit tests can stay green while tsc fails on the missing module.
- `/code-review` diffs the orchestrator session's cwd — the main checkout — not the worktree, so a lane's uncommitted changes are invisible to it and it silently reviews whatever the main checkout's diff is (often the last already-merged PR). To review a lane's work, commit it on the lane branch first and review that ref, or spawn a review agent pointed explicitly at the worktree path (`git -C <worktree> diff`). Never trust a code-review launched from the main session against uncommitted worktree work.
- Push each successive slice of a lane under a fresh remote branch name instead of force-pushing over an already-merged tip.
- After rebasing a long-lived worktree onto main, diff `app/env.server.ts`/`app/framework/env.server.ts` against your lane's base commit — a newly-required env var must be mirrored into the worktree's gitignored `.env`/`.env.test` or the dev server and test global-setup crash.
- If a configured port is already bound, never kill the listener to reclaim it — it may be a sibling lane's live server. Start on a different free port with an overridden `PORT`/`HMR_PORT` instead. The exception is your own lane's zombie: a dead `pnpm run dev` task can leave maildev holding the port ("dev:maildev exited with 1") — find it with `lsof -iTCP:<port>` and kill it.
- Never kill lane processes by matching command names (`pkill -f "dev:worker"` and kin) — every lane runs identical command lines, so the match reaches into sibling lanes and takes down their servers or workers. Kill by the lane's own ports, or use `pnpm run worktree:processes --kill --lane <lane>`, which filters by working directory.
- Turborepo's cache is shared across lanes: a gate command may replay a task another worktree computed, and the replayed log then prints that other lane's absolute paths. The result is still correct — the cache is content-addressed — but a path in a gate log is not evidence of where the task ran, and a task you expected to run fresh may not have.
- `db:migrate`/`db:rollback` install the `graphile_worker` schema before regenerating types. If you ever run `kysely-codegen`/`db:generate` by hand against a database, make sure that schema exists first — otherwise every `GraphileWorker*` interface silently vanishes from `types.d.ts` while tsc stays green.
- Teardown only ever drops databases named `app_wt_*`. The main `app_development` and `app_test`, and the shared `app_template_*` databases, can never be collateral.
- Never edit the main checkout's `.env`/`.env.test` from a worktree task; each worktree owns its own copies.
- The managed block in worktree env files is marked with `# --- managed by scripts/worktree (per-worktree isolation) ---`. Its presence is the idempotency sentinel — do not remove it by hand.
- `NEW_RELIC_ENABLED` is forced to `false` in worktrees so parallel lanes do not report telemetry as the main dev app.
- E2E in a worktree requires `pnpm run build` first: `test:server` runs with `NODE_ENV=test`, which serves the production build.
- The E2E database is not the test database: a lane runs E2E against the derived `app_wt_<lane>_test_e2e` (the testing skill covers the derivation). When an E2E seed error says to "drop the E2E database and rerun" — typically after a rebase brought in seed content the long-lived E2E database predates — drop that derived `_e2e` database, never the `app_wt_<lane>_test` that `.env.test`'s `DATABASE_URL` names (that one is the unit-test database). If the unit database does get dropped by mistake, re-running `pnpm run worktree:setup <lane>` restores it from the template without touching the branch or the development database.
- The dev seed runs in a single process (`pnpm run db:seed:dev` → `apps/web/app/db/dev-seed/seed.ts`, which calls the production seeds and then the development ones). It is single-shot and destructive: an empty-database pre-flight (`apps/web/app/db/dev-seed/preflight.ts`) aborts if the target already holds application data, naming the non-empty tables — so there is no in-place reseed. To reseed a lane, tear down and set up again (which drops and recreates the database); dropping the database kills a running dev server's connection pool, so restart the worktree's dev server afterwards. The coverage-manifest test (`apps/web/app/db/dev-seed/coverage.test.ts`) exercises this same pipeline against its own scratch database.
- The per-worktree env files live at `apps/web/.env` and `apps/web/.env.test` (the app is the `@app/web` workspace). Implementation lives in `apps/web/scripts/worktree/` (`common.ts` holds the pure, unit-tested logic, `template.ts` the template databases; `setup.ts`/`teardown.ts` are the entry points; both accept `--hook` for the Claude Code hook contract: JSON on stdin, worktree path on stdout).
