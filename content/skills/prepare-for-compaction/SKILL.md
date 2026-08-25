---
name: prepare-for-compaction
description: Make this session's ledger current so its context can be compacted safely, then answer plainly whether compacting is safe. Use ONLY when the user explicitly invokes /prepare-for-compaction — the person types this command, never you.
---

# Prepare for compaction

The person is about to compact this session's context and is waiting on one answer: is the ledger current?

Make it current before answering — read the ledger and update it on the spot with everything the work has added since its last entry. A ledger that is behind is something to fix here, never something to report. Then answer plainly that compacting is safe.

This is one step of the ritual the person drives: spot the moment, prepare, compact, reground.
