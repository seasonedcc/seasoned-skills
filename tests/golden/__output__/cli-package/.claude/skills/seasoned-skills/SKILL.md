---
name: seasoned-skills
description: Install, configure, upgrade, and repair the seasoned-skills workflow package — the source of this project's generated doctrine, skills, and runtime code. Use when installing or upgrading the workflow, changing seasoned-skills.config.ts, running or debugging the sync, reading a failed-sync report, or wiring a new machine.
---

# The seasoned-skills workflow

This project's workflow — the doctrine file, the generated skills, the hooks, the status line, the provisioning — comes from the `seasoned-skills` npm package. Everything generated is rebuilt by `seasoned-skills sync` and is gitignored: never edit a generated file, because the next sync rewrites it. What the project owns, and what git carries, are the configuration (`seasoned-skills.config.ts`), the content directory it points at, and the committed artifacts the workflow reads (calibrations, registers, shaping documents, meeting records).

## The moving parts

- **`seasoned-skills.config.ts`** — the project's declarations: name, merge strategy, release target, gate commands, and the optional surfaces (web, demo seed, machine surface, stack, provisioning). Every option is stated explicitly; changing one and running sync is how the workflow's shape changes.
- **The content directory** — one markdown file per generated skill plus one for the doctrine layer. Each file's front matter may carry `triggers:` (the project's own activation vocabulary) and its body weaves into the skill as the project-specifics section. Content files are mandatory for every enabled skill; an empty file is valid, a missing one fails the sync loudly.
- **`seasoned-skills sync`** — regenerates everything: doctrine, skills, runtime scripts, the managed gitignore block, and the managed settings keys. It never scaffolds and never touches committed content. The project's own `prepare` script runs it on every install, so a fresh clone materializes the whole workflow with the package-manager command the project already runs.
- **`seasoned-skills doctor`** — derives a machine checklist from the configuration and reports what is missing, with install pointers. Advisory everywhere: it never blocks.

## Installing

Adoption runs once, interactively: `seasoned-skills install`. It writes the configuration scaffold (asking for every option the rulings give no default), creates the committed artifacts, scaffolds the content files empty, builds the shaping corpus (asking for the one commercial book, falling back to the distilled account), wires the sync into the prepare script, and finishes by running sync and doctor.

## Upgrading

Versions are exact-pinned; pre-1.0 releases may break in any release. An upgrade is agent work:

1. Read the new version's release notes — they carry migration instructions written for agents, including any calibration review a Definition-of-Done expansion demands.
2. Bump the pinned version, install, and let the prepare script sync.
3. Discharge every migration instruction in the project, then run the project's gates.
4. Open the upgrade as a pull request like any other change.

## When sync fails

Sync fails loud and leaves the project in a deliberate degraded state: every generated file is deleted except this skill, and a minimal doctrine file carries the full error report with a standing order to repair before working. To repair:

1. Read the error report — it lists every problem at once (invalid configuration values, missing content files), never just the first.
2. Fix the configuration or add the named content files (empty is valid).
3. Run `seasoned-skills sync` again; the workflow rematerializes completely.

Never work around a failed sync by hand-writing generated files — fix the input and regenerate.

## Where lessons about the workflow go

A lesson about the workflow itself — a generic rule that would improve every consuming project — travels as a detailed issue on `seasonedcc/seasoned-skills`: the scenario, anonymized specifics, and suggestions marked as suggestions. Issues are the package's demand records; the package changes only through its own shaping process.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/seasoned-skills.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
