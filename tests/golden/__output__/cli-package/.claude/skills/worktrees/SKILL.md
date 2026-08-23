---
name: worktrees
description: Run parallel tasks in isolated git worktrees, each provisioned as a lane with its own databases, ports, env files, and services through the seasoned-skills binary. Use when creating or removing worktrees, provisioning or tearing down lanes, running parallel tasks or agents, starting a dev server for a specific lane, handing a lane to the user for manual testing, or when the user mentions worktree, parallel lanes, or isolated environments.
---

# Worktrees

Each worktree is an isolated lane: its own git checkout, and — for every resource the project's provisioning table declares — its own databases on the shared local database server, its own ports, its own cache-store index, and its own copies of the gitignored env files. Parallel tasks never share uncommitted state or data, so dev servers, test runs, and browser sessions can run concurrently across lanes. In a multi-repository workspace, worktrees are cut from each repository being changed — never from a root that only carries setup — and one provisioning run covers the repositories the table declares.

## Lifecycle

### Create

```bash
seasoned-skills provision <lane>
seasoned-skills provision <lane> --branch feature/name   # custom branch (default worktree/<lane>)
seasoned-skills provision <lane> --base origin/main      # custom base (default origin's HEAD branch)
seasoned-skills provision <lane> --skip-provision        # worktree only, no deps/databases
seasoned-skills provision <lane> --skip-seed             # provision and migrate, but leave the databases empty
seasoned-skills provision <lane> --fresh-seed            # re-anchor the demo data to today
```

`<lane>` is a short lowercase slug naming the task (e.g. `fix-webhook-retry`). Setup is idempotent: re-running reuses the registered worktree, its databases, its ports, and its cache-store index — the managed env block is the allocation record, read back before anything is assigned — and rewrites that block in place. Only a database setup creates in that same run is seeded, so re-running never writes over the data a lane already holds. It prints a summary with the lane's path, branch, databases, ports, and whether the lane was seeded.

What setup does, driven entirely by the resource table in `seasoned-skills.config.ts`: creates the worktree (branching from the base), copies the gitignored env files from the main checkout and rewrites the managed keys to lane-specific values derived from the main checkout's own, creates the lane's databases on the same servers, installs dependencies and runs each repository's declared provision steps, migrates, and seeds the databases created in that run — so a lane's data is the development seed's, never a copy of whatever the main checkout happens to hold. A skipped seed prints its reason and carries it into the summary. Shared services the machine may already run are probed before being started, and polled until they answer before anything touches them. A freshly allocated cache-store index is flushed at allocation, so no lane inherits another's leftovers.

Where the project enables template caching, setup copies a fingerprinted template database instead of migrating and seeding from scratch. The fingerprint — content hashes of the migration and seed sources, plus the date the seed ran — is stored on the template itself; a changed source or a stale seed date rebuilds the template transparently, and `--fresh-seed` forces the demo data to re-anchor to today. Templates are shared by every lane and never dropped by teardown.

### Work

Everything runs from inside the worktree directory with the project's usual commands — the lane's env files carry the isolation, so the dev server, the worker, and the test suites all land on the lane's own ports and databases.

Every process the lane needs beyond a single turn — a dev server, a worker — runs as its own harness background task, never forked with `&` inside another task's shell: stopping the wrapper task kills its entire process group, the server included. Every lane process is swept at session end, so expect lane servers to be gone after a session ends and restart them when resuming.

To read a lane's assignments later, read the managed block in its env files:

```bash
grep -A 10 'managed by' <worktree>/.env
```

### Browser testing

Point the browser at the lane's dev-server port, and use one browser session per lane, named after the lane, so cookies never mix — the browser skill carries the rest of the discipline:

```bash
agent-browser open http://localhost:<DEV_SERVER_PORT>/ --session <lane>
```

### Teardown

```bash
seasoned-skills teardown <lane>            # refuses if the worktree has uncommitted changes
seasoned-skills teardown <lane> --force    # removes anyway
```

Teardown kills processes listening on the lane's managed ports — so a worker stack orphaned by a killed run cannot outlive the lane — flushes the lane's cache-store index (so a recycled index never leaks a previous lane's keys or queue backlogs), drops the lane's whole derived-database family (the derived-name patterns live in the resource table, so nothing derived is ever orphaned), and removes the worktree. It never touches the branch (it may back a PR).

Run teardown from outside the worktree being removed — removal deletes the shell's working directory, so every later command in the same chain fails (git exits 128 on a vanished cwd).

Never chain teardown behind a prerequisite with `;` — it runs even when the prerequisite failed. Confirm the merge (or whatever the teardown waits on) actually succeeded, then tear down as its own command.

Give teardown a generous timeout (ten minutes) or run it in the background — never a default two-minute command budget. On a loaded machine the port sweep alone can eat minutes, and a kill that lands mid-`git worktree remove` leaves a half-deleted tree that the next attempt's uncommitted-changes check refuses to touch. If that happens, confirm the branch's commits are merged, then `git worktree remove --force` by hand.

## A worktree the user drives

A lane can be handed to the user for manual testing. From then on the tree is the user's: touch only what was explicitly delegated — typically keeping the lane current and its dev server running.

The handback protocol, every time new work merges into the lane's branch:

1. `git fetch origin` and fast-forward the lane. If the tree is dirty or the branch has diverged, stop and surface it instead of forcing it current.
2. Sync dependencies, then migrate the lane's databases.
3. Restart the dev server by the exact PID recorded in the lane's pid file (the file holds a plain number and nothing else, so a restart never has to guess which process is the lane's).
4. Verify the server answers, then tell the user the lane is ready.

A database the user is driving is the user's working state: anything beyond that routine that would change database state — a repair, a faked migration record, a drop, a reseed — asks first. When the sync renames migration files, a long-lived database migrated under the old names can fail the migrate on changes it already holds (the renamed migrations are unrecorded, but the schema they add is already there): diagnose the renames against the database's recorded migration history, propose the exact repair, and get the user's yes before running it.

## Naming and isolation model

Worktrees land in a `-worktrees` directory beside the checkout they were cut from, one per lane, on a branch defaulting to `worktree/<lane>`. Every lane resource is namespaced by the lane's slug: database names derive from the resource table's declared databases, ports derive from the declared port bases, and the cache-store index is per lane. A lane's port assignment may be a whole block rather than a single port — a test suite can serve the product once per parallel worker — and allocation hands out and reserves whole blocks, including the blocks it reads back from sibling lanes' env files, so two lanes can run their suites at the same time.

Ports and cache-store indexes start from a deterministic hash of the lane slug; ports are then probed for availability and indexes are allocated against the indexes sibling lanes' env files already claim. Once assigned, both live in the managed block and survive re-runs. The main checkout keeps its defaults — lane isolation lives entirely in the worktrees' gitignored env files, and the main checkout's own env files are the source of truth for where the shared servers live on this machine.

Shared across lanes (by design): the local database server, the local cache store (isolation is by database name and index), the package-manager caches, and any external service credentials copied from the env files. Anything a lane does against external services is visible to other lanes. Database contents are not shared: each lane's databases are created empty and seeded, so nothing a lane writes — and nothing the main checkout holds — reaches another lane.

## Guardrails and gotchas

- When the task's base is anything other than the repo's default branch (a goal's feature branch, a release branch), pass `--base` explicitly — setup defaults to the default branch, and a lane provisioned off the wrong base looks healthy until its diff or its databases lie. `--base` only applies when setup creates the branch: an existing branch is checked out as-is (setup fast-forwards it when it is strictly behind its origin counterpart, and prints a warning when the two have diverged or when an explicit `--base` is being ignored). Verify the `base` shown in setup's final summary — and for a lane on a pre-existing branch, that the worktree's HEAD matches the origin tip you expect — before using the lane.
- Never run a lane's end-to-end suite and a browser session concurrently in the same lane: both claim the lane's single dev-server port — the suite starts its own server stack on it, and browser work needs the lane's dev server listening on it — so the two runs collide. Sequence them, or give the browser work its own lane.
- Per-lane resource pools are finite — a cache store has a fixed number of indexes — and exhaust silently after enough provisioned lanes. Tear down finished lanes between waves — teardown frees the lane's index, databases, and ports for the next wave.
- Read-only work — audits, reviews, censuses — and documentation-only changes get their OWN worktree, never a build lane's tree and never a branch on the main checkout (checkouts never leave the default branch): `--skip-provision` makes a lane cheap, and a plain `git worktree add` serves deliberately unprovisioned work, removed afterwards with `git worktree remove`. And before ANY teardown, check the live task/agent roster for agents still reading that tree: a teardown under a live reader corrupts the reader's run.
- Never kill lane processes by matching command names (`pkill -f` and kin) — every lane runs identical command lines, so the match reaches into sibling lanes and takes down their servers or workers. Kill by exact process id only, and sweep orphans with `seasoned-skills sweep`, which lists lane processes, filters by lane, and kills only by exact id — the same sweep runs at session end.
- Where the project shares a content-addressed build cache across lanes, a gate command may replay a task another worktree computed, and the replayed log then prints that other lane's absolute paths. The result is still correct, but a path in a gate log is not evidence of where the task ran, and a task you expected to run fresh may not have.
- Setup migrates and seeds with the code present at creation time. A worktree later moved to a newer base (rebase, checkout, pull) keeps its old databases — routes can fail on missing relations and seeded state can predate seed changes on the new base. After moving a worktree's base, drop and recreate the lane's databases, migrate, and reseed before trusting anything the app shows.
- The same staleness applies to installed dependencies: a worktree keeps the install from its creation time, and a base move can bring code that needs a dependency the worktree never installed. The failure is misleading — tests owned by untouched sibling surfaces fail on the new code's runtime resolution while the same suite is green in the main checkout and on CI. After moving a worktree's base, run the dependency install before trusting any gate the worktree runs.
- Run post-merge routines (pull, dependency install, migrate, baseline tests) only from the main checkout — inside a worktree, migrate and seed hit the lane's isolated databases, and run from the main checkout they hit the main development databases. Always include the dependency install: a merged PR can add a dependency, and tests can stay green while the app fails on the missing module.
- Pushes from a lane always name an explicit refspec (`git push origin HEAD:worktree/<lane>`). Never rely on a bare `git push`: the lane branch's upstream is not necessarily the lane branch, so a bare push can aim at the base branch or fail in a way that looks like the push succeeded.
- Push each successive slice of a lane under a fresh remote branch name instead of force-pushing over an already-merged tip.
- If a configured port is already bound, never kill the listener to reclaim it — it may be a sibling lane's live server. Re-run setup (it probes for a free port) or start on a different free port. The exception is your own lane's zombie process — find it with `lsof -iTCP:<port>` and kill it.
- Teardown only ever drops the lane-namespaced databases the resource table derives, and only kills port listeners that run from inside the lane's own worktree. The main development databases and sibling lanes' servers can never be collateral.
- Never edit the main checkout's env files from a worktree task; each worktree owns its own copies.
- The managed block in lane env files is marked with a `managed by` comment. Its presence is the idempotency sentinel — do not remove it by hand.
- After rebasing a long-lived worktree onto main, diff the repo's env surface (its env sample or schema) against your lane's base commit — a newly-required env var must be mirrored into the worktree's gitignored env files or the dev server and tests crash.
- Provisioning is implemented once, inside the seasoned-skills package, driven by the resource table the project's configuration declares — projects carry no provisioning scripts of their own, and `seasoned-skills doctor` checks the binaries and services the machine needs.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/worktrees.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
