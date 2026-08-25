This repository is the home of the Seasoned workflow — the doctrine, practice skills, and deterministic code our projects share — shipped as the `seasoned-skills` npm package with a CLI. It is also consumer number zero: the workflow it ships is installed here from the package itself, so the repo works under the very rules it distributes.

The existing `seasonedcc/shaping-skill`, `seasonedcc/requests-from-meetings-skill`, and `seasonedcc/claude-code-statusline` repos will be absorbed into this one and deleted once every consuming project has migrated.

## Essential commands

```bash
pnpm install          # Install dependencies (prepare builds and syncs)
pnpm build            # Compile to dist/
pnpm check            # Biome check
pnpm tsc              # Type-check
pnpm test:unit        # Unit tests
pnpm test:golden      # Golden-output tests
```

## Copy verbatim, edit later

Whenever content is brought into this repo from a source (a reference project, a book, a transcript, anything), copy it with `cp` first, verbatim, and only edit it afterwards in separate steps. Never retype or reproduce copied content by writing it out — LLMs have a tendency to modify content when writing, even when they don't intend to. After copying, verify with `diff -r` (or `diff` for single files) that the copy is byte-for-byte identical before making any edits.

## Copyrighted corpora are never committed

Reference corpora that carry copyrighted material (the shaping corpus, and any like it) exist only in per-machine caches, built by machinery on each user's machine. They must never enter this repo's history — the repo distributes machinery and our own prose, never the texts.

## Reference projects stay private

This repo is public. The workflow here is developed against private reference projects. Never mention those projects — their names, organizations, domains, or code — in anything visible in this repo: files, PR bodies, commit messages, code, comments, or issues. Describe every change entirely on its own terms; the reference lives only in the conversation and in subagent charters.

## Human-facing pages follow the docs-copywriting skill

Every page written for people rather than agents — the README, everything under `docs/`, and any other human-facing prose — is written under the committed skill at `.claude/skills/docs-copywriting/`. Load it before writing or reviewing such a page: it is the binding voice guide, and its translation table makes dialect violations mechanical to spot, so the review loop's conventions pass quotes it against every docs diff.

## Fast-forward main from the main checkout

After a merge, the default branch fast-forwards in the repo's main checkout — `cd` there explicitly before `git merge --ff-only origin/main`. Run inside a lane worktree, the same command moves the lane's branch onto the merge commit instead of advancing main; that happened twice in one session before this rule was written down.
