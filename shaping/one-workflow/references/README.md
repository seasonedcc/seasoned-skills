# References

Battle-tested source material the build inherits. Three working systems ran this
workflow daily before it was packaged; their instruction files and supporting code are
collected here so the build starts from proven text, not a blank page. Identifying
details were neutralized; the substance is untouched. Variant letters are consistent
across the whole tree — the same source system is the same letter everywhere.

The shaping document's rulings decide how variants merge. Its Contract notes name the
base variant for each merged skill and what gets grafted from the others; where a
variant disagrees with the document, the document wins.

## Layout

- `doctrine/` — three variants of the standing instruction file every session reads
  first (the doctrine layer's raw material).
- `skills/<name>/variant-<x>/` — the practice skills, one folder per source variant,
  each carrying its `SKILL.md` and any `references/` material it ships with.
- `stack/<name>/variant-<x>/` — the stack-layer skills for the packaged stack.
- `code/` — the supporting tools:
  - `worktree-provisioning/` — three implementations (two TypeScript, one shell) to be
    unified into the package's single TypeScript implementation; variant A's test file
    shows the testing bar the unified version must meet.
  - `hooks/` — the safety and hygiene hooks (stash blocking, worktree setup/teardown,
    session-end process sweep, explicit-cd enforcement).
  - `watchdog/` — the subagent transcript-size watchdog.
  - `browser-sweep/` — the browser-process sweep tool.
  - `requests-verification/` — the verbatim-quote verifier that ships with the
    meeting-requests skill.
  - `statusline/` — the status-line script the package absorbs, with its
    model-demotion alarm.
