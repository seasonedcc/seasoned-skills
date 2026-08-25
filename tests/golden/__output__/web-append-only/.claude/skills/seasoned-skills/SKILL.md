---
name: seasoned-skills
description: Install, configure, upgrade, and repair the seasoned-skills workflow package — the source of this project's generated doctrine, skills, and runtime code. Use when installing or upgrading the workflow, changing seasoned-skills.config.ts, running or debugging the sync, reading a failed-sync report, or wiring a new machine. Also use when asked how this project's workflow is generated or where a generated file comes from.
---

# The seasoned-skills workflow

This project's workflow — the doctrine file, the generated skills, the hooks, the status line, the provisioning — comes from the `seasoned-skills` npm package. Everything generated is rebuilt by `seasoned-skills sync` and is gitignored: never edit a generated file, because the next sync rewrites it. What the project owns, and what git carries, are the configuration (`seasoned-skills.config.ts`), the content directory it points at, and the committed artifacts the workflow reads (calibrations, registers, shaping documents, meeting records).

## The moving parts

- **`seasoned-skills.config.ts`** — the project's declarations: name, merge strategy, release target, gate commands, and the optional surfaces (web, demo seed, machine surface, stack, provisioning). Every option is stated explicitly; changing one and running sync is how the workflow's shape changes.
- **The content directory** — one markdown file per generated skill plus one for the doctrine layer. Each file's front matter may carry `triggers:` (the project's own activation vocabulary) and its body weaves into the skill as the project-specifics section. Every file is optional: a missing one simply means the project has nothing to add there. The directory itself is not — sync fails when it is gone, so a mistyped `contentDir` can never quietly drop every authored instruction (an empty directory is perfectly valid). What else fails the sync is a top-level entry nothing would ever load: a name matching no known one, an extension that only looks like markdown (`.md` alone loads), a link whose target no longer exists, or a file that exists without a section its skill requires. Subdirectories are free space; nothing loads from them.
- **`seasoned-skills sync`** — regenerates everything: doctrine, skills, runtime scripts, the managed gitignore block, and the managed settings keys. It never scaffolds and never touches committed content. The project's own `prepare` script runs it on every install, so a fresh clone materializes the whole workflow with the package-manager command the project already runs.
- **`seasoned-skills doctor`** — derives a machine checklist from the configuration and reports what is missing, with install pointers. Advisory everywhere: it never blocks.

## Installing

Adoption runs once, interactively: `seasoned-skills install`. It writes the configuration scaffold (asking for every option the rulings give no default), creates the committed artifacts, builds the shaping corpus when this machine's cache is missing or stale (asking for the one commercial book, falling back to the distilled account), wires the sync into the prepare script, and finishes by running sync and doctor.

The committed artifacts arrive as templates, and templates are all a CLI can write: seeding them is the adopting agent's work, because only reading the project answers what belongs in them. Seed the option-gated registers from what the project already carries — above all the coverage register, which starts as the list of surfaces its specs do not reach today — and the calibration file from whatever calibration text the project kept elsewhere. A register left at its template says the project has nothing to declare, which is almost never true.

## Upgrading

Versions are exact-pinned; pre-1.0 releases may break in any release. An upgrade is agent work:

1. Read the new version's release notes — they carry migration instructions written for agents, including any calibration review a Definition-of-Done expansion demands.
2. Bump the pinned version, install, and let the prepare script sync.
3. Discharge every migration instruction in the project, then run the project's gates.
4. Open the upgrade as a pull request like any other change.

## When sync fails

Sync fails loud and leaves the project in a deliberate degraded state: every generated file is deleted except this skill, and a minimal doctrine file carries the full error report with a standing order to repair before working. To repair:

1. Read the error report — it lists every problem at once (invalid configuration values, content the sync cannot use), never just the first.
2. Fix the configuration, or fix every content entry the report names: rename it to the skill it belongs to, give it the `.md` extension, point a broken link back at its file, write the section it is missing (a file with no skill can move into a subdirectory, or go).
3. Run `seasoned-skills sync` again; the workflow rematerializes completely.

Never work around a failed sync by hand-writing generated files — fix the input and regenerate.

## Where lessons about the workflow go

A lesson about the workflow itself — a generic rule that would improve every consuming project — travels as a detailed issue on `seasonedcc/seasoned-skills`: the scenario, anonymized specifics, and suggestions marked as suggestions. Issues are the package's demand records; the package changes only through its own shaping process.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/seasoned-skills.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
