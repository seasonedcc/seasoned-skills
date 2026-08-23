---
name: release
description: Release new versions of the composable-controllers packages via Changesets. Analyze the diff, write the changeset, run checks, commit, ask the user to publish, and create per-package GitHub releases. Use when the user mentions releasing, publishing, cutting a release, or shipping a new version.
metadata:
  internal: true
---

# Release

Automate the release workflow for the `composable-controllers` monorepo, which publishes two packages (`@composable-controllers/core`, `@composable-controllers/react-router`) using Changesets.

The user does not know how to use Changesets and does not want to learn — drive the toolchain end-to-end on their behalf. They will simply say "release" or "ship a minor"; analyze the diff, decide the bumps, write the changeset, and proceed.

## Instructions

### 0. Verify on main branch

Before doing anything else, confirm the working tree is on `main` and up to date:

```bash
git branch --show-current
```

If not on `main`, switch and pull:

```bash
git checkout main && git pull
```

**Never start a release from a feature branch.** Version bumps, commits, and tags must land on `main`.

### 1. Align pre mode, then ensure a changeset exists

#### 1a. Reconcile pre mode with the user's intent

Check whether the repo is currently in pre mode:

```bash
test -f .changeset/pre.json && cat .changeset/pre.json
```

Decide based on the user's wording:

- "alpha" / "beta" / "rc" / "prerelease" → if not in pre mode, enter it:
  ```bash
  pnpm changeset pre enter alpha   # or beta / rc
  ```
  If already in pre mode with a different tag, tell the user and ask before switching (rare).
- "stable" / "final" / no qualifier → if currently in pre mode, exit it:
  ```bash
  pnpm changeset pre exit
  ```
  The next `pnpm version` will then roll all accumulated prereleases into a single stable release.

Edits to `.changeset/pre.json` (created or removed by the commands above) are part of the eventual release commit — do not commit or revert them separately.

#### 1b. Reuse pending changesets if any exist

```bash
ls .changeset/*.md 2>/dev/null | grep -vE 'README|pre\.json'
```

If one or more files are listed, read them and treat them as authoritative — a contributor may have added them as part of their PR. Skip to step 2.

#### 1c. Otherwise, write the changeset from diff analysis

For each of the two packages, find the last per-package tag and walk the diff:

```bash
# Repeat per package — pkg-prefix is one of:
#   @composable-controllers/core
#   @composable-controllers/react-router
git tag --list '<pkg-prefix>@*' --sort=-version:refname | head -1
git log <last-tag>..HEAD --oneline -- packages/<pkg>/
git diff <last-tag>..HEAD -- packages/<pkg>/src/index.ts packages/<pkg>/package.json
```

Where `<pkg>` is `core` or `react-router` (the directory name under `packages/`).

If the package has no prior tag, walk from the repo's first commit (`git rev-list --max-parents=0 HEAD`) and treat as the package's first release. While the package is below `1.0.0`, prefer minor bumps for new features and major bumps only for genuine breaking changes; once it crosses `1.0.0`, full semver applies.

Read recent PR bodies in parallel to enrich your understanding:

```bash
gh pr list --search "is:merged base:main" --json number,title,author,mergedAt --limit 30
gh pr view <number> --json body,title,files --jq '.title + "\n---\n" + .body'   # in parallel
```

For each package with commits since its last tag, decide a bump level:

- **major** — peer/dependency requirement raised in a way that excludes prior versions; an export was removed or renamed in `src/index.ts`; a function signature or runtime behavior changed in a way that breaks existing callers.
- **minor** — new export added to `src/index.ts`; new optional API surface; new framework adapter shipped.
- **patch** — bug fix, internal refactor, dependency bump that does not restrict callers, JSDoc/type tweaks that ship with the package.

If a package directory has no commits since its last tag, do not include it in the changeset.

The example app at `examples/react-router-app/` is private (`"private": true` in its `package.json`) — Changesets ignores it. Never include it in a changeset.

Write a single changeset file at `.changeset/<descriptive-kebab>.md` covering all bumped packages. Use a short, content-derived kebab-case name (e.g. `act-recipe-headers.md`):

```markdown
---
"@composable-controllers/core": minor
"@composable-controllers/react-router": patch
---

Add support for X in the core API. Fix Y in the RR adapter.
```

The summary becomes the bullet in each affected package's `CHANGELOG.md`, so write it in user-facing language drawn from PR titles/bodies (or commit subjects when no PR is available).

After writing the file, state the plan to the user in one sentence — e.g. "Bumping `@composable-controllers/core` to a minor and `@composable-controllers/react-router` to a patch — proceeding to `pnpm version`." Do not stop for explicit y/n; the file is reversible until the commit in step 4. The user can interrupt if the heuristic was wrong.

### 2. Apply the version bump

```bash
pnpm version
```

This runs `changeset version`, which consumes pending `.changeset/*.md` files, updates each affected `packages/*/package.json` version, regenerates per-package `CHANGELOG.md` files, and updates `pnpm-lock.yaml`.

Capture which packages and versions changed:

```bash
git diff --stat
git diff packages/*/package.json
```

Note the new version of each bumped package — these become the tag names later.

### 3. Run checks

```bash
pnpm lint-fix && pnpm lint && pnpm tsc && pnpm test && pnpm build
```

All must pass before committing. Turbo fans these out across packages.

### 4. Commit and push

Stage the version bumps, the regenerated `CHANGELOG.md` files, the consumed (deleted) `.changeset/*.md` files, and `pnpm-lock.yaml`. Commit message format:

- Single package bumped: `Release <pkg>@<version>` (e.g. `Release @composable-controllers/core@0.2.0`)
- Both packages bumped: `Release @composable-controllers/core@<v1>, @composable-controllers/react-router@<v2>` — or a short summary like `Release 2026-04-27` if both versions are long.

Push to `main`.

### 5. Ask the user to publish

Tell the user to run from the repo root:

```bash
pnpm release
```

Which expands to `turbo run build && changeset publish`. This pushes each bumped package to npm and creates the per-package git tags (`@composable-controllers/core@X.Y.Z`, `@composable-controllers/react-router@X.Y.Z`).

For prerelease cycles, no extra flag is needed — `changeset publish` reads `.changeset/pre.json` and tags the npm release with the active pre tag (alpha/beta/rc) instead of `latest`.

**Do not run `pnpm release` yourself** — npm publish requires an OTP. Wait for the user to confirm they've published before continuing.

After they confirm, fetch the new tags locally:

```bash
git fetch --tags
```

### 6. Create one GitHub release per bumped package

For **each** package bumped in step 2, repeat 6a–6d.

Tag prefixes:
- `@composable-controllers/core` → `@composable-controllers/core@`
- `@composable-controllers/react-router` → `@composable-controllers/react-router@`

#### 6a. Find the previous tag for that package

```bash
git tag --list '<pkg-tag-prefix>@*' --sort=-version:refname | head -2
```

The first entry is the new tag just created; the second (if any) is the previous release for comparison. If there is no previous tag (first release of that package), use the repo's first commit (`git rev-list --max-parents=0 HEAD`) as the base.

#### 6b. Analyze changes in depth

Do not just copy the CHANGELOG. Study the actual changes to understand what they mean for users.

1. **Dependency changes first** — diff `packages/<pkg>/package.json` between previous and new tag. `peerDependencies` bumps are the highest-impact breaking change because they gate who can install the package at all (e.g. raising the React Router peer dep from `>=7` to `>=8` blocks every user on RR 7). Flag these immediately.
2. **Public API diff** — diff `packages/<pkg>/src/index.ts` for added/removed exports.
3. **Filter commits to the package's path**:
   ```bash
   git log <prev-tag>..<new-tag> --oneline -- packages/<pkg>/
   ```
4. **List merged PRs in the window**:
   ```bash
   gh pr list --search "is:merged merged:>=<prev-tag-date>" --json number,title,author --limit 100
   ```
5. **Read every relevant PR's body** — PR bodies contain author-written summaries, migration instructions, and context that titles and diffs alone don't provide:
   ```bash
   gh pr view <number> --json body,title --jq '.title + "\n---\n" + .body'
   ```
   Run these in parallel (all PR reads in a single message) for efficiency. Filter to PRs that touched `packages/<pkg>/`.
6. **Read the changed source code** when a PR description is missing or unclear — don't assume what a change does from the title alone.

#### 6c. Compose release notes

Use the section Changesets just appended to `packages/<pkg>/CHANGELOG.md` as the spine — it is already grouped by bump type. Then enrich with the structure below, including only sections that apply:

- `## Breaking Changes` — narrative subsections explaining each breaking change, what it replaces, and what users need to do. Order by impact: **dependency requirement changes first**, then behavioral or API changes. Include code examples showing before/after when helpful.
- `## New Features` — bullet points with **bold title**, PR number in parens, and a one-line description drawn from the PR body.
- `## Bug Fixes` — bullet points with PR number and linked issue closes (e.g. "Closes #123").
- `## What's Changed` — full PR list with author links:

```
* <title> by @<author> in https://github.com/seasonedcc/composable-controllers/pull/<number>
```

End with:

```
**Full Changelog**: https://github.com/seasonedcc/composable-controllers/compare/<prev-tag>...<new-tag>
```

For a package's first release, replace the compare URL with a link to the new tag:

```
**Full Changelog**: https://github.com/seasonedcc/composable-controllers/commits/<new-tag>
```

#### 6d. Create the release

For **stable** versions:

```bash
gh release create '<new-tag>' --title '<new-tag>' --notes "$(cat <<'EOF'
<release-notes>
EOF
)"
```

For **prerelease** versions (anything containing `-alpha`/`-beta`/`-rc` in the version):

```bash
gh release create '<new-tag>' --title '<new-tag>' --prerelease --notes "$(cat <<'EOF'
<release-notes>
EOF
)"
```

Always **single-quote the tag** — it contains `@` and `/`, which the shell will otherwise misinterpret. Pass notes via HEREDOC to preserve formatting. Run releases sequentially per bumped package.
