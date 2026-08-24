---
'seasoned-skills': minor
---

Provisioning resources now belong to the repository that owns them, and a lane
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
a repository joins it later, and a port or database name two covered
repositories both declare is refused by name. Repositories that never share a
lane are free to reuse each other's names.

This is a breaking configuration change with no compatibility shim: move the
top-level `databases`, `portBases`, `portBlocks`, `envFile`, `envFiles`,
`templateCaching`, `cacheStoreIndex`, `cacheStoreEnvKeys`, `migrationSources`,
and `seedSources` into the `repositories` entry that owns them before upgrading.
