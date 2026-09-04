# Subagent calibrations

Calibrations are stated relative to the Definition of Done and accrete
through pull requests as sessions learn what this project needs.

## Documentation effort, 2026-08

Measured under the Definition of Done as it stood before the
documentation-currency criterion landed mid-effort. A surface change now
carries its documentation in the same task, so the code-lane entries below
read as floors rather than estimates.

- Hand-written documentation lane (the README plus three top-level pages,
  unprovisioned worktree, voice skill loaded): the builder finished at 13%
  (135k tokens, 56 turns). A read-only fact-check of every claim across the
  four pages: 19% (185k). Narrower re-verify and recheck passes: 10% each.
- Package-code lane (two generated skills, a sync guard, and the
  content-file contract, test-driven across ~37 files): the builder finished
  at 16% (160k); its eleven-item review-fix pass at 19%.
- Reference-documentation lane (four reference pages plus a typed key
  manifest and a two-direction enumeration test with mutation proofs): the
  builder finished at 23% (226k) — the effort's ceiling. Its review-fix pass
  split into a code stage at 21% and a prose stage at 17%. A lane bigger
  than this shape should split the guard machinery from the prose.
- Closing-audit halves (read-only, one auditor per document half): 9–11%
  each. A surgical single-mechanism fix lane with snapshot updates: 7%.
