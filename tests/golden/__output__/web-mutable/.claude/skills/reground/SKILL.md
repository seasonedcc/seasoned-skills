---
name: reground
description: Reground after a compaction — from this session's ledger and the real sources of truth, never from the compacted summary alone. Use ONLY when the user explicitly invokes /reground — the person types this command, never you.
---

# Reground

The context you are holding is a compaction summary, and a summary is not the state of the work.

Reground before anything else: read the ledger, and check what it says against the real sources of truth — the codebase, the pull requests, the artifacts themselves. Where they disagree, the real sources win.

This is one step of the ritual the person drives: spot the moment, prepare, compact, reground.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/reground.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
