## Patch versions only, for now

Every changeset this project writes declares a **patch** bump, whatever the change's nature — breaking configuration changes included. The user ruled it during the 0.0.4 release, when `changeset version` staged a minor: "Let's not do semver yet. Please only make patch versions for now." The package sits pre-1.0 precisely so breaking changes can ship as patches; full semver starts only when the user opts into it.

## The publish is verified on the registry, never taken on someone's word

A "published" answer is a claim. After the user reports publishing, run `npm view seasoned-skills version` and continue only when the registry shows the new version. One release's publish confirmation turned out to be wrong — npm still held the previous version — and the registry read was the only thing that caught it.

## Plain `pnpm publish` creates no git tag

This project publishes with plain `pnpm publish`, which pushes to npm and stops — it never creates the release tag. After verifying the publish on the registry, create `v<version>` on the release commit yourself and push it; the GitHub release hangs off that tag. Three releases in a row have needed this step.

## Stale local tags from the history rewrite

The repository's history was rewritten before it went public, so a long-lived local checkout can hold pre-rewrite tags that a plain `git fetch --tags` refuses to move. When a tag fetch is rejected with a clobber error, realign with `git fetch origin --tags --force` before tagging anything new.
