# seasoned-skills

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
