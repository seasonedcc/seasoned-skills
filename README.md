# seasoned-skills

The Seasoned workflow as a package: every project's working agreements — the
doctrine, the practice skills, the optional stack layer, the deterministic
tooling, and the shaping corpus machinery — generated from one source of
truth, installed with one command, and kept current by upgrading a version.

A project adopts the workflow by installing this package and answering an
interview once. From then on, everything the workflow needs inside the project
is **generated**: the instructions, the skills, the hooks, the scripts, the
document assets. The project commits only its configuration and its own
content; the generated files are gitignored, and `seasoned-skills sync`
regenerates them all, idempotently, from the installed version. Differences
between projects are configuration, never forks.

## Before you install

Installing assumes a codebase that is ready for the workflow. The workflow's
criteria lean on machinery this package does not create — put it in place
first, or leave the matching option off until it exists.

**Every project needs:**

- A **git repository with a GitHub remote**. The workflow works in branches,
  worktrees, and pull requests, and the review and self-improvement skills act
  on pull requests and issues through `gh`.
- A **`package.json`**. The install pins this package at an **exact version**
  — the premise pre-1.0 upgrades rely on — and sync keeps one managed
  script entry (`prepare`) that re-runs `seasoned-skills sync`.
- **Gates a continuous-integration run can execute**: the lint, typecheck, and
  test commands you declare in the configuration must actually run and
  actually gate. A test suite that gates nothing real makes the workflow's
  promises hollow.

**Per option, the configuration assumes:**

- `webSurface` — a route surface the stack can enumerate and an end-to-end
  suite that can reach it. This is an unswitched criterion with brownfield
  on-ramps rather than an off switch: the coverage register is seeded with the
  surfaces you haven't reached yet and only ever shrinks, and surfaces a spec
  genuinely cannot reach live in the excused list, each with a one-line
  written rationale.
- `demoSeed` — a working seed pipeline. The criterion asserts that every new
  or changed user-facing surface ships its seed section and its manifest entry
  in the same change; it needs the pipeline and the committed manifest to
  assert into.
- `machineSurface` — a committed capability-parity standard and exception
  register for your MCP server or public API.
- `stack` — a React Router + Kysely codebase, and a declared database
  mutability stance (`append-only` or `mutable-when-not-derivable`); the
  stack skills are generated around that stance.
- `provisioning` — the resource table describing your isolated worktree
  lanes: the databases (the primary repository must declare a migrate
  command), the port bases, the shared services, the repositories. It assumes
  a reachable Postgres server, and a Redis server when `cacheStoreIndex` is
  on.
- **Demo videos** (projects with a web surface) — the generated rig records
  narrated product demos, and it needs three things from the project: a
  `demo:video` script running
  `tsx .claude/skills/demo-videos/scripts/rig/run.ts`, the `tsx` and
  `@playwright/test` dev dependencies, and a committed `demo-videos/session.ts`
  module that logs an actor in and returns the session cookie (the rig's
  README documents the contract). The narration model's weights are fetched
  once per machine by the rig's own `setup.sh` — never by the install.

**Your pipeline provides**, per enabled criterion — workflow files are
project-owned machinery the package never generates, so this is a contract,
not a template:

- the **gate jobs**: the lint, typecheck, and test commands your configuration
  declares, each a required check;
- the **end-to-end job** where `webSurface` is on — the acceptance gate the
  Definition of Done reads before a change counts as done;
- the **seed-manifest job** where `demoSeed` is on — the check that fails a
  user-facing surface nobody claimed a seed section for.

**The machine** needs the binaries the enabled workflow depends on — `git`,
`gh`, `jq`, and `python3`, plus the toolchains the always-shipping practices
run on: `whisper-cli` with the pinned `ggml-large-v3` model for meeting
transcription, and `uv` and `ffmpeg` for demo-video narration. Beyond those,
`agent-browser` where there is a web surface, and the service starter
(`docker` by default) and `redis-cli` where provisioning declares services and
a cache store. A project with needs of its own adds them to
`machinePrerequisites` in its configuration. Run `seasoned-skills doctor` for
the mechanical version of this list, derived from your configuration, with
install pointers for anything missing. Doctor is advisory everywhere: it never
blocks, because enforcement lives in the gates that need the tools.

## Installing

```sh
pnpm add -D -E seasoned-skills
pnpm exec seasoned-skills install
```

The install is a one-time interactive scaffold. It asks for every option that
has no ruled default — nothing defaults silently — then creates the
committed artifacts: `seasoned-skills.config.ts` stating every option
explicitly, the content files (empty — they are where your project's own
rules accumulate), the calibration file, the shaping folder, and the registers
the enabled options need. It never overwrites anything that exists. When this
machine has no current shaping corpus, it asks for your own copy of the one
commercial book (an empty answer takes the distilled account instead) and
builds the corpus before finishing. It finishes by running a sync and printing
the doctor report.

After that, `seasoned-skills sync` is the only moving part: it regenerates
every generated file from the configuration and content, deletes what a
configuration change stops generating, and manages exactly two files and one
script entry in the project's own space — the ignore entries (verified
through git itself), the managed settings keys, and the `prepare` script.

If a sync cannot run — a content file missing, a broken configuration — it
fails loud: the generated workflow is removed down to the repair kit (the
package's own skill plus a minimal instructions file carrying the full error
report), so a half-generated workflow can never masquerade as a working one.
Fix the inputs and sync again.

## The shaping corpus

The shaping skill carries the verbatim texts of the books and posts the method
comes from — but those texts never enter any repository. They are built into
a per-machine cache, which the install builds for you the first time. To
rebuild it — a new machine, or a package upgrade that moved the corpus:

```sh
seasoned-skills corpus
```

fetches the freely published sources from their authors' sites and verifies
the result. The one commercial book is vendored from your own compiled copy
with `--book <path>`; without it, a distilled account written for this
workflow stands in. Each project's sync weaves the cache into the generated
skill; a missing or stale cache shows up in the doctor report.

## Staying current

Every consuming project pins an exact version. Upgrading is deliberate: bump
the version, read that release's migration notes, and sync — the `prepare`
script does it on install. Pre-1.0, breaking changes land in any release; the
exact pin and the migration notes are what make that safe.

## Commands

| Command | What it does |
| --- | --- |
| `install` | One-time interactive scaffold, then sync and doctor. |
| `sync` | Regenerate everything from configuration and content. Idempotent; fails loud. |
| `doctor` | Check the machine against the configured workflow's needs. Advisory. |
| `corpus` | Build the shaping corpus into this machine's cache. |
| `provision <lane>` | Set up an isolated worktree lane from the resource table. |
| `teardown <lane>` | Remove a lane: processes, databases, cache index, worktrees. |
| `sweep` | Sweep leftover automated browsers or lane processes. |

## This repository

This repository is consumer number zero: it holds itself to the same adopter's
bar this README states, in the form that applies to a command-line package —
its own CI running both test tiers as required checks, comprehensive coverage
behind them, and the workflow installed from the package it ships.

## License

[MIT](LICENSE).
