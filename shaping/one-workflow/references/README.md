# References

Battle-tested source material the build inherits. Three working systems ran this
workflow daily before it was packaged; their instruction files and supporting code are
collected here so the build starts from proven text, not a blank page. Identifying
details were neutralized; the substance is untouched. Variant letters are consistent
across the whole tree — the same source system is the same letter everywhere.

The shaping document's rulings decide how variants merge. Its Contract notes name the
base variant for each merged skill and what gets grafted from the others; where a
variant disagrees with the document, the document wins.

Not every skill preserves every variant: where a copy is absent it was dropped
deliberately — byte-identical to a preserved copy, or wholly superseded by the base
the document names — and the document's merge tables adjudicate on the full set,
absent copies included. A file lives in the tree closest to its merged home, which is
not always the layer its source system kept it in.

## Layout

- `doctrine/` — three variants of the standing instruction file every session reads
  first (the doctrine layer's raw material).
- `skills/<name>/variant-<x>/` — the practice skills, one folder per source variant,
  each carrying its `SKILL.md` and any `references/` material it ships with. The
  release skill alone carries a fourth variant, `variant-d`: the shared release
  practice of our own published npm packages, copied from its most evolved copy.
  That source is public, so unlike the three systems it keeps its identity openly.
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
  - `demo-videos/` — the demo-video machinery: the recording rig and its tests,
    the narration engine, the transcription and setup flows, and the pinned
    narrator voice sample with its license and provenance notes.
  - `corpus-machinery/` — the shaping-corpus build scripts: download and parse
    for the freely published sources, the vendoring script for the one
    commercial book (it takes the book already compiled to markdown), and the
    index writer/verifier. The scripts for the excluded talk and interview
    material are deliberately not preserved.
