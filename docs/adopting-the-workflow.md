# Adopting the workflow

The workflow arrives as an npm package with a command-line tool. A project
adopts all of it or none of it: the pieces reference each other, so there
is no half-adopted layer. Once installed, everything the workflow needs
inside the project is generated from the package, and staying current
means upgrading a version.

Installing assumes a codebase that is ready for it. The workflow's rules
lean on machinery this package does not create, so put that machinery in
place first, or leave the matching option off until it exists.

## What every project needs

- **Claude Code.** The workflow runs inside Claude Code, the coding tool
  the agents work in: the package generates the instructions and skills
  Claude Code reads, and a shaped project's build starts with its `/goal`
  feature, which this package does not ship.
- **A git repository with a GitHub remote.** The workflow works in
  branches, worktrees, and pull requests, and the review and
  self-improvement skills act on pull requests and issues through `gh`.
- **A `package.json`.** The one item the install can create for you: it
  writes a minimal manifest when the repository has none. The package is
  pinned at an exact version (the `-E` in the install command below, and
  the premise pre-1.0 upgrades rely on), and sync keeps one managed
  script entry, `prepare`, that re-runs `seasoned-skills sync`.
- **Gates a continuous-integration run can execute.** Gates are the lint,
  typecheck, and test commands you declare in the configuration; they
  must actually run and actually block a failing change. A test suite
  that gates nothing real makes the workflow's promises hollow.

## What each option assumes

- **`webSurface`**: routes your framework can list, and an end-to-end
  test suite that can reach them. The rule that every screen is reachable
  by a test has no off switch; for existing codebases it has on-ramps
  instead: the coverage register is seeded with the screens no test
  reaches yet and only ever shrinks, and a screen a test genuinely cannot
  reach lives on the excused list with a one-line written reason.
- **`demoSeed`**: a working demo-data seed pipeline. The rule it backs
  says every new or changed user-facing screen ships its seed section and
  its entry in the committed seed manifest in the same change, and it
  needs the pipeline and the manifest to exist.
- **`machineSurface`**: a committed standard saying what your MCP server
  or public API must be capable of, held against the product itself, plus
  the register of ruled exceptions.
- **`stack`**: a React Router + Kysely codebase, and a declared stance
  on database writes (`append-only` or `mutable-when-not-derivable`); the
  stack skills are generated around that stance.
- **`provisioning`**: the table describing your isolated worktree lanes:
  the repositories a lane can span, and what each of them owns (its
  databases, with a migrate command per entry that declares any; its port
  bases; its env files), plus the shared services the machine provides.
  `provision <lane> --repo <path>` picks which declared repositories a
  lane covers, defaulting to the first, and teardown always sweeps the
  whole table. It assumes a reachable Postgres server for any entry that
  declares databases, and a Redis server for any entry with
  `cacheStoreIndex` on.
- **Demo videos**: the generated
  rig records narrated product demos, and it needs three things from the
  project: a `demo:video` script running
  `tsx .claude/skills/demo-videos/scripts/rig/run.ts`, the `tsx` and
  `@playwright/test` dev dependencies, and a committed
  `demo-videos/session.ts` module that logs an actor in and returns the
  session cookie (the rig's README documents the contract). The narration
  model's weights are fetched once per machine by the rig's own
  `setup.sh`, never by the install.

## What your pipeline provides

The package never generates continuous-integration workflow files; they
are your project's own machinery, and what follows is the contract they
must meet per enabled option:

- the **gate jobs**: the lint, typecheck, and test commands your
  configuration declares, each a required check;
- the **end-to-end job** where `webSurface` is on, the acceptance gate
  the workflow reads before a change counts as done;
- the **seed-manifest job** where `demoSeed` is on, the check that fails
  a user-facing screen nobody claimed a seed section for.

## What the machine needs

The binaries the enabled workflow depends on: `git`, `gh`, `jq`, and
`python3`, plus the toolchains the always-shipping practices run on:
`whisper-cli` with the pinned `ggml-large-v3` and `ggml-silero-v5.1.2`
models for meeting transcription, and `uv` and `ffmpeg` for demo-video
narration, which needs an Apple Silicon Mac. Doctor also looks for the
narration model's weights on every project. Beyond
those, `agent-browser` where there are web screens to drive, and the
service starter (`docker` by default) and `redis-cli` where provisioning
declares services and a cache store. A project with needs of its own adds
them to `machinePrerequisites` in its configuration.

Run `seasoned-skills doctor` for the mechanical version of this list,
derived from your configuration, with install pointers for anything
missing. Doctor never blocks; enforcement lives in the gates that need the
tools.

## Installing

```sh
pnpm add -D -E seasoned-skills
pnpm exec seasoned-skills install
```

The install is a one-time interactive scaffold. It asks for every option
that has no ruled default (nothing defaults silently), then creates the
committed pieces the workflow reads: `seasoned-skills.config.ts` stating
every option explicitly, the shaping and meeting-requests folders, the
calibration file, the registers the enabled options need, the content
files the interview already has answers for, and a minimal
`package.json` when the repository has none. It never overwrites
anything that exists. When this machine has no current reference
library for the shaping skill, it asks for your own copy of the one
commercial book (an
empty answer takes the distilled account instead) and builds the library
before finishing. It ends by running a sync and printing the doctor
report.

After that, `seasoned-skills sync` is what turns the configuration and
content into the workflow your agents read: it regenerates every
generated file,
deletes whatever a configuration change stops generating, and manages
exactly two files and one script entry in your project's own space: the
ignore entries (verified through git itself), the settings keys the
workflow depends on, and the `prepare` script.

Your project's own rules accumulate in content files, one per generated
skill plus one for the standing instructions. Every content file is
optional: a missing one simply means your project has nothing to add.

If a sync cannot run (a broken configuration, or a content file whose
name the package does not recognize) it fails loud: the generated
workflow is removed down to the repair kit, the package's own skill plus
a minimal instructions file carrying the full error report, so a
half-generated workflow can never pass for a working one. Fix the inputs
and sync again.

## The reference library

The shaping skill works from the verbatim books and posts its method
comes from, but those texts never enter any repository. They are built
into a cache on each person's machine, and the install builds it for you
the first time. To rebuild it, on a new machine or after an upgrade that
moved things:

```sh
seasoned-skills corpus
```

It fetches the freely published sources from their authors' own sites and
verifies the result. The one commercial book is taken from your own
compiled copy with `--book <path>`; without it, a distilled account
written for this workflow stands in. Each project's sync weaves the cache
into the generated skill, and a missing or stale cache shows up in the
doctor report.

## Staying current

Every consuming project pins an exact version, so upgrading is
deliberate: bump the version, read that release's migration notes, and
sync (the `prepare` script does it on install). The migration notes are
written for agents to execute, so upgrading the workflow is itself agent
work. Pre-1.0, breaking changes land in any release; the exact pin and
the migration notes are what make that safe.

## Where to look next

[The way of working](the-way-of-working.md) tells the whole story of how
work moves through the workflow, and [Running a session](running-a-session.md)
is the manual for the person at the keyboard. For lookups, the reference:
[the commands](reference/commands.md),
[the configuration file](reference/configuration.md),
[what a project receives](reference/what-a-project-receives.md), and
[the files and settings the package manages](reference/managed-footprint.md).
