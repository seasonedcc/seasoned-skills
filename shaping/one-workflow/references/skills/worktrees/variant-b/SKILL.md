---
name: worktrees
description: Run parallel tasks in isolated git worktrees, each with its own databases, ports, env files, and dev server. Use when creating or removing worktrees, running parallel tasks or agents, starting a dev server for a specific worktree, running browser tests against an isolated server, or when the user mentions worktree, parallel lanes, or isolated environments.
---

# Worktrees

Each worktree is a fully isolated copy of the app: its own git checkout, its own development and test databases on the shared local Postgres, its own ports, and its own maildev. Parallel tasks never share state, so dev servers, unit tests, E2E tests, and browser sessions can run concurrently across worktrees.

## Lifecycle

### Create

From the main checkout (or any worktree — the scripts resolve the main repository):

```bash
pnpm run worktree:setup <lane>
pnpm run worktree:setup <lane> --branch feature/name   # custom branch (default worktree/<lane>)
pnpm run worktree:setup <lane> --base origin/main      # custom base (default origin/main)
pnpm run worktree:setup <lane> --skip-seed             # skip the dev seed
```

Setup is idempotent: re-running reuses the registered worktree, its ports, and its databases. It prints a summary with every port and database name. Claude Code's `WorktreeCreate`/`WorktreeRemove` hooks (wired in `.claude/settings.json`) run the same scripts automatically for harness-created worktrees.

What setup does: creates the worktree at `../app-worktrees/<lane>` from `origin/main`, copies `.env` and `.env.test` from the main checkout and rewrites the managed keys, creates and migrates both databases, runs `pnpm install`, and seeds the development database (only when it was just created — the seed is not re-runnable).

### Work

Everything runs from inside the worktree directory with the usual commands — the worktree's `.env` files carry the isolation:

```bash
cd ../app-worktrees/<lane>
pnpm run dev          # dev server + maildev on this worktree's ports
pnpm run dev:worker   # graphile-worker against this worktree's database
pnpm run test:unit    # resets and migrates only this worktree's test database
pnpm run build && pnpm run test:e2e tests/<spec>.spec.ts   # E2E needs a build first (test server runs the production build)
```

Run only the specs the lane touches — the full E2E suite is the PR's CI job, not a local step.

The setup summary (and the worktree's `.env`/`.env.test`) tells you the ports. To read them later:

```bash
grep -A 10 'managed by scripts/worktree' .env .env.test
```

### Browser testing

Point agent-browser at the worktree's dev server port, and read emails from the worktree's own maildev REST API (login is passwordless, so magic links arrive there):

```bash
agent-browser open http://localhost:<PORT>/auth/email --session <lane>
curl -s http://localhost:<MAILDEV_WEB_PORT>/email | ...   # fetch the magic link
```

Use one agent-browser `--session` per worktree so cookies never mix.

### Teardown

```bash
pnpm run worktree:teardown <lane>            # refuses if the worktree has uncommitted changes
pnpm run worktree:teardown <lane> --force    # removes anyway
```

Teardown kills processes listening on the worktree's ports — the whole E2E block included, so a worker stack orphaned by a killed run cannot outlive the lane — drops both databases, and removes the worktree. It never touches the branch (it may back a PR). The `WorktreeRemove` hook does the same minus the directory removal (the harness handles that) and never blocks.

Run teardown from the main repo checkout, never from inside the worktree being removed — removal deletes the shell's working directory, so every later command in the same chain fails (git exits 128 on a vanished cwd).

Never chain teardown behind a prerequisite with `;` — it runs even when the prerequisite failed. Confirm the merge (or whatever the teardown waits on) actually succeeded, then tear down as its own command.

Give teardown a generous timeout (ten minutes) or run it in the background — never a default two-minute command budget. On a loaded machine the port sweep alone (`lsof` per port) can eat minutes, and a kill that lands mid-`git worktree remove` leaves a half-deleted tree that the next attempt's uncommitted-changes check refuses to touch. If that happens, confirm the branch's commits are merged, then `git worktree remove --force` by hand.

## Naming and isolation model

| Resource | Convention | Example (lane `task-a`) |
| --- | --- | --- |
| Worktree directory | `../app-worktrees/<lane>` | `../app-worktrees/task-a` |
| Branch | `worktree/<lane>` | `worktree/task-a` |
| Dev database | `app_wt_<slug>_development` | `app_wt_task_a_development` |
| Test database | `app_wt_<slug>_test` | `app_wt_task_a_test` |
| Dev server / HMR | `PORT` / `HMR_PORT` in `.env` | 7100+ / 26700+ |
| Dev maildev SMTP / web | `MAILDEV_PORT` / `MAILDEV_WEB_PORT` in `.env` | 15100+ / 16100+ |
| Test server / maildev | same keys in `.env.test` | 8100+ (four ports) / 17100+ / 18100+ |

Ports are spread deterministically by a hash of the lane slug, then probed for availability. The lane's test `PORT` heads a four-port block rather than a single port: an E2E run serves the product once per Playwright worker, on `PORT` through `PORT + 3`. Planning hands out and reserves whole blocks — including the blocks it reads back from sibling lanes' env files, and the hash itself steps in whole blocks — so two lanes can run their suites at the same time. The main checkout keeps its defaults (7002, 26680, 1047, 1087, `app_development`, `app_test`) — worktree isolation lives entirely in the worktrees' gitignored env files.

Shared across worktrees (by design): the local Postgres server, the pnpm store (installs are hardlinks, so they are fast), and external service credentials copied from `.env` (DigitalOcean Spaces). Anything a task does against those external services is visible to other worktrees.

The shared Postgres also shares its connection budget (`max_connections`, typically 100). Several lanes running test suites at once can exhaust it: unit tests fail with `sorry, too many clients already` or plain timeouts yet pass in isolation, and pages drop to the error boundary under load. That is host contention, not a defect in the branch — do not chase it; re-run alone or let the PR's CI, which has the database to itself, be the arbiter.

## Guardrails and gotchas

- Start a worktree's dev server and worker as their own background tasks — never with `&` inside another task's shell. Stopping that wrapper task kills its entire process group, the server included.
- NEVER run `git stash` inside a worktree. The stash is one stack shared by the main repo and every worktree, so a concurrent lane's push/pop can silently swap or drop another lane's uncommitted work. To shelve work, use `git diff > <file>.patch` (restore with `git apply`) or a WIP commit.
- When the main checkout is parked on a non-main branch (a parallel session owns it), never answer repo-state questions from its working tree — `grep`, `Read`, and file listings there report the parked branch's state, not main's, and the difference reads as convincingly real. Query the ref directly instead: `git fetch origin main`, then `git grep <pattern> origin/main -- <path>` and `git show origin/main:<file>`.
- Run post-merge routines (pull, `pnpm install`, migrate, seed, baseline tests) only from the main checkout — inside a worktree, the branch tracks the lane ref and `db:migrate` hits the lane's isolated database. Always include `pnpm install`: a merged PR can add a dependency, and unit tests can stay green while tsc fails on the missing module.
- Push each successive slice of a lane under a fresh remote branch name instead of force-pushing over an already-merged tip.
- After rebasing a long-lived worktree onto main, diff `app/env.server.ts`/`app/framework/env.server.ts` against your lane's base commit — a newly-required env var must be mirrored into the worktree's gitignored `.env`/`.env.test` or the dev server and test global-setup crash.
- If a configured port is already bound, never kill the listener to reclaim it — it may be a sibling lane's live server. Start on a different free port with an overridden `PORT`/`HMR_PORT` instead. The exception is your own lane's zombie: a dead `pnpm run dev` task can leave maildev holding the port ("dev:maildev exited with 1") — find it with `lsof -iTCP:<port>` and kill it.
- `db:migrate`/`db:rollback` install the `graphile_worker` schema before regenerating types. If you ever run `kysely-codegen`/`db:generate` by hand against a database, make sure that schema exists first — otherwise every `GraphileWorker*` interface silently vanishes from `types.d.ts` while tsc stays green.
- Teardown only ever drops databases named `app_wt_*`. The main `app_development` and `app_test` can never be collateral.
- Never edit the main checkout's `.env`/`.env.test` from a worktree task; each worktree owns its own copies.
- The managed block in worktree env files is marked with `# --- managed by scripts/worktree (per-worktree isolation) ---`. Its presence is the idempotency sentinel — do not remove it by hand.
- `NEW_RELIC_ENABLED` is forced to `false` in worktrees so parallel lanes do not report telemetry as the main dev app.
- E2E in a worktree requires `pnpm run build` first: each Playwright worker spawns its own `node ./server.js` with `NODE_ENV=test`, which serves the production build.
- Document upload/download against a worktree's `pnpm run dev` needs Docker running: `usesLocalStorage()` is `NODE_ENV === 'test'` only, so the dev server talks to MinIO on :9000, and with Docker down every upload fails `ECONNREFUSED` while the UI silently shows no document. To browse real document state without Docker, run the built app with `pnpm run test:server` (local file storage) and load the E2E auth state: `agent-browser state load tests/.auth/state.json`.
- The dev seed only runs when the development database is first created. To reseed, tear down and set up again.
- Setup migrates and seeds with the code present at creation time. A worktree later moved to a newer base (rebase, checkout, pull) keeps its old databases — routes can 500 on missing relations and seeded state can predate seed changes on the new base. After moving a worktree's base, drop and recreate both databases, migrate, and reseed before trusting anything the app or the docs-screenshot runner shows.
- The same staleness applies to `node_modules`: a worktree keeps the install from its creation time, and a base move can bring code that needs a dependency the worktree never installed. The failure is misleading — unit tests owned by untouched sibling surfaces fail on the new code's runtime resolution while the same suite is green in the main checkout and on CI. After moving a worktree's base, run `pnpm install` before trusting any gate the worktree runs.
- Implementation lives in `scripts/worktree/` (`common.ts` holds the pure, unit-tested logic; `setup.ts`/`teardown.ts` are the entry points; both accept `--hook` for the Claude Code hook contract: JSON on stdin, worktree path on stdout).
