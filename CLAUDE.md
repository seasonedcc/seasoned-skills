# seasoned-skills

This repo is the home of the Seasoned workflow: the skills, processes, and deterministic code our projects share. It will ship as a `seasoned-skills` npm package with a CLI, so a project adopts the workflow — and stays current — by upgrading a version.

The existing `seasonedcc/shaping-skill` and `seasonedcc/requests-from-meetings-skill` repos will be absorbed into this one and deleted once every consuming project has migrated.

## Copy verbatim, edit later

Whenever content is brought into this repo from a source (a reference project, a book, a transcript, anything), copy it with `cp` first, verbatim, and only edit it afterwards in separate steps. Never retype or reproduce copied content by writing it out — LLMs have a tendency to modify content when writing, even when they don't intend to. After copying, verify with `diff -r` (or `diff` for single files) that the copy is byte-for-byte identical before making any edits.

## Copyrighted corpora are never committed

Reference corpora that carry copyrighted material (the shaping skill's `references/`, and any like it) exist only in local working trees, built by machinery on each user's machine. They are gitignored and must never enter this repo's history — the repo distributes machinery and our own prose, never the texts.

## Reference projects stay private

This repo is public. The workflow here is developed against private reference projects. Never mention those projects — their names, organizations, domains, or code — in anything visible in this repo: files, PR bodies, commit messages, code, comments, or issues. Describe every change entirely on its own terms; the reference lives only in the conversation and in subagent charters.
