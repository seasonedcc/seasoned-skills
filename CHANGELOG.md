# seasoned-skills

## 0.0.7

### Patch Changes

- Write the managed model setting as the `fable[1m]` family alias instead of a pinned model id, so the orchestrator runs the newest Fable as soon as Claude Code ships it, with no package release in between. The `[1m]` suffix keeps the million-token context window the subagent sizing assumes.

## 0.0.6

### Patch Changes

- Two new skills, `/prepare-for-compaction` and `/reground`, ship to every project: the first brings the session ledger current and answers that compacting is safe; the second regrounds after a compaction from the ledger and the real sources of truth instead of the compacted summary. Every project content file is now optional, the doctrine file included, so the new skills arrive with no migration step and empty content files can be deleted; `install` no longer scaffolds them. In their place, sync fails loud on content that cannot load: a missing content directory, a top-level markdown file matching no known name, a `.markdown` or `.mdx` extension the loader passes over, a link whose target is gone, and a content file that exists without a section its skill requires — all reported in one failure. The package's one-line description is now "Seasoned's skills to orchestrate the full product cycle with AI agents", and the repository gains full documentation: a README front door, three teaching pages, and four reference pages kept true by an enumeration test.

## 0.0.5

### Patch Changes

- 4366f1a: A fresh lane branch is created without an upstream. Creating it from a
  remote-tracking base made git adopt that base as the branch's upstream, so a
  bare `git push` from the lane aimed at the base branch instead of failing
  loudly and asking for the explicit refspec. Adopted origin branches already
  avoided this; now new branches do too.

## 0.0.4

### Patch Changes

- ee91fe2: Provisioning resources now belong to the repository that owns them, and a lane
  chooses which repositories it covers. `provisioning.repositories` entries carry
  `databases`, `envFile`/`envFiles`, `portBases`, `portBlocks`, `templateCaching`,
  `cacheStoreIndex`, `cacheStoreEnvKeys`, `migrationSources`, and `seedSources`
  alongside the `provisionSteps`, `migrateCommand`, and `seedCommand` they already
  had; every one of those options is read from the entry's own worktree and its
  own main checkout. `provisioning` itself keeps only what is project- or
  machine-scoped: the repository table, the shared `services` and
  `serviceStartCommand`, `databasePrefix`, `seedDateTimezone`, and
  `laneProcessCommands`. The positional "primary repository" is gone — declaration
  order is now only the default selection.
  
  `seasoned-skills provision <lane>` gains a repeatable `--repo <path>`, taking a
  declared repository's path exactly as the configuration spells it; a value that
  matches no entry is refused with the declared paths listed. Without the flag a
  lane covers the first declared entry alone, so a multi-repository workspace can
  declare every sibling repository — a monolith with databases, a Node repo that
  only needs its dependencies installed, a Go repo that needs nothing — and still
  cut single-repository lanes. Every covered repository gets the same
  worktree-and-branch handling: a stale local lane branch fast-forwarded to its
  origin tip, an existing `origin/<branch>` adopted without an upstream, a
  diverged local branch left alone. `teardown <lane>` takes no selection and
  sweeps the lane across the whole declared table, passing quietly over
  repositories that never registered a worktree.
  
  Ports and the cache-store index stay lane-wide: the port pool is collected
  across the repositories a run covers, ports the lane already holds are kept when
  a repository joins it later, and a port name two covered repositories both
  declare is refused by name. Port names are scoped to a selection, so
  repositories that never share a lane are free to reuse each other's. Database
  names are not: a lane database is named from the prefix, the lane slug, and the
  resource name, and a template database from the prefix and the resource name —
  neither carries the repository — so a database name two declared repositories
  share is refused for the whole table, whether or not one lane ever covers both.
  
  This is a breaking configuration change with no compatibility shim: move the
  top-level `databases`, `portBases`, `portBlocks`, `envFile`, `envFiles`,
  `templateCaching`, `cacheStoreIndex`, `cacheStoreEnvKeys`, `migrationSources`,
  and `seedSources` into the `repositories` entry that owns them before upgrading.
  A configuration that still carries any of them at the top level is refused by
  name — never silently ignored, which would have run the lane against the
  developer's own databases.

## 0.0.3

### Patch Changes

- 3d5d31b: `seasoned-skills install` now works when its answers are piped in: the interview reads through a buffering line reader instead of dropping every line that arrived while no question was pending, so a scripted adoption scaffolds the project instead of exiting silently having created nothing. An interview whose input ends before the last answer now fails loudly and exits non-zero. The install also builds the shaping corpus when this machine's cache is missing or stale — asking for your own compiled copy of the one commercial book, taking the distilled account when the answer is empty — so adoption no longer leaves the shaping skill without references until someone runs `seasoned-skills corpus` by hand. A present, current cache is left alone and the question is not asked.
  
  The managed gitignore block gains the two entries the generated skills already promise: `requests-from-meetings/config.local.json` (the per-user meetings path) and `/demo-videos/*/*.mp4` (the finished video copied beside its screenplay). Doctor gains the toolchains the always-shipping practices run on — `whisper-cli` and both pinned model files meeting transcription decodes with, `ggml-large-v3` for the first pass and `ggml-silero-v5.1.2` for the voice-activity re-decode; `uv` and `ffmpeg` for demo-video narration, together with the narration weights that skill's own setup step caches beside its generated scripts, so a machine that never ran setup surfaces in the report rather than mid-render — and `ffmpeg` is no longer gated behind a web surface, nor reported missing when it is installed (it answers `-version`, not `--version`). A project with prerequisites of its own declares them in `machinePrerequisites`, each entry a `binary`, a `reason`, and a `hint`; doctor stays advisory. The configuration scaffold states `provisioning` as a commented resource table rather than omitting the option.
  
  Content: the shaping skill paraphrases the two sentences it had quoted verbatim from the commercial book, so no copyrighted text ships under `content/`, and it drops a stale paragraph teaching transcript citation for a corpus that has no transcripts. The package's own skill now states that the adopting agent seeds the option-gated registers and the calibration file from what the project already carries — the CLI scaffolds templates and cannot judge either. The README documents the install's corpus build, the CI contract's per-criterion jobs, and the corrected machine list.
- The merge-authority doctrine now holds under either goal-merge mode: the orchestration fragment no longer lists goals among the things that never authorize a merge — the `agentMergesDuringGoal` option decides that, and each goal fragment states its answer explicitly — and the main-sync and review-fixes skills defer to the project's standing merge rule instead of restating the opt-out variant of it.

## 0.0.2

### Patch Changes

- 77da46a: Provisioning can now manage multiple env files per lane via `envFiles`, each entry recording its own slice of the allocation under its own key names (the same key may mean different ports in different files), with per-file managed blocks, partial-state restore, and teardown reading every file. The stack layer gains two shipped checkers: `seedCoverage`/`seedCoverageFailures` derive the demo-seed criterion's denominator from the app's route config, and `IDENTIFIER_LENGTH_AUDIT_SQL`/`identifierLengthFailures` audit the database for names at the 63-byte truncation boundary. The checkouts-and-worktrees doctrine now names the shipped CLI commands, and the shaping skill's interviewer researches external facts on the web and re-reads everything the user sent before each round of questions.
  
  Lane provisioning also creates every declared database before running any migration (a repo whose migrate command touches all its databases per run no longer crashes on the not-yet-created one), adopts a branch that exists only on origin when provisioning a lane for it (without setting an upstream), and fast-forwards a stale local lane branch that is strictly behind origin — a diverged local branch is left untouched. The release skill's deployed-product verifier path and the mcp-server skill's permission-helper wording were corrected.

## 0.0.1

### Patch Changes

- 0900d4b: Initial release of the Seasoned workflow as an installable package: the
  doctrine layer, the practice skills, the optional stack layer, the
  deterministic code (worktree provisioning, hooks, watchdog, sweeps, status
  line, requests verifier, demo-video rig, document assets), and the corpus
  machinery — installed with `seasoned-skills install`, regenerated with
  `seasoned-skills sync`, and checked with `seasoned-skills doctor`.
