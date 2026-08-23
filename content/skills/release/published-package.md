## The release: published packages

A release publishes new versions of this project's npm packages via Changesets, and ends with one GitHub release per bumped package. The packages, their release-tag prefixes, and the command the user runs locally to publish each:

{{packages}}

The user does not need to know how to use Changesets — drive the toolchain end-to-end on their behalf. They will simply say "release" or "ship a minor"; analyze the diff, decide the bumps, write the changeset, and proceed.

### 0. Verify on the default branch

Before doing anything else, confirm the working tree is on the default branch (`main`) and up to date:

```bash
git branch --show-current
```

If not, switch and pull:

```bash
git checkout main && git pull
```

**Never start a release from a feature branch.** Version bumps, commits, and tags must land on the default branch.

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
  The next `changeset version` will then roll all accumulated prereleases into a single stable release.

Edits to `.changeset/pre.json` (created or removed by the commands above) are part of the eventual release commit — do not commit or revert them separately.

#### 1b. Reuse pending changesets if any exist

```bash
ls .changeset/*.md 2>/dev/null | grep -vE 'README|pre\.json'
```

If one or more files are listed, read them and treat them as authoritative — a contributor may have added them as part of their PR. Skip to step 2.

#### 1c. Otherwise, write the changeset from diff analysis

For each package, find the last per-package tag and walk the diff:

```bash
# Repeat per package — <tag-prefix> is the package's release-tag prefix listed above
git tag --list '<tag-prefix>*' --sort=-version:refname | head -1
git log <last-tag>..HEAD --oneline -- <package-dir>/
git diff <last-tag>..HEAD -- <package-dir>/<public-entry> <package-dir>/package.json
```

Where `<package-dir>` is the package's directory in the repository and `<public-entry>` is its public entry point (e.g. `src/index.ts`).

If the package has no prior tag, walk from the repo's first commit (`git rev-list --max-parents=0 HEAD`) and treat as the package's first release. While the package is below `1.0.0`, prefer minor bumps for new features and major bumps only for genuine breaking changes; once it crosses `1.0.0`, full semver applies.

Read recent PR bodies in parallel to enrich your understanding:

```bash
gh pr list --search "is:merged base:main" --json number,title,author,mergedAt --limit 30
gh pr view <number> --json body,title,files --jq '.title + "\n---\n" + .body'   # in parallel
```

For each package with commits since its last tag, decide a bump level:

- **major** — peer/dependency requirement raised in a way that excludes prior versions; an export was removed or renamed in the public entry point; a function signature or runtime behavior changed in a way that breaks existing callers.
- **minor** — new export added to the public entry point; new optional API surface.
- **patch** — bug fix, internal refactor, dependency bump that does not restrict callers, JSDoc/type tweaks that ship with the package.

If a package directory has no commits since its last tag, do not include it in the changeset.

Workspace packages marked `"private": true` in their `package.json` (example apps, internal tooling) are ignored by Changesets. Never include them in a changeset.

Write a single changeset file at `.changeset/<descriptive-kebab>.md` covering all bumped packages. Use a short, content-derived kebab-case name (e.g. `act-recipe-headers.md`):

```markdown
---
"<package-name>": minor
"<other-package-name>": patch
---

Add support for X in the first package. Fix Y in the second.
```

The summary becomes the bullet in each affected package's `CHANGELOG.md`, so write it in user-facing language drawn from PR titles/bodies (or commit subjects when no PR is available).

After writing the file, state the plan to the user in one sentence — e.g. "Bumping `<package-name>` to a minor and `<other-package-name>` to a patch — proceeding to `changeset version`." Do not stop for explicit y/n; the file is reversible until the commit in step 4. The user can interrupt if the heuristic was wrong.

### 2. Apply the version bump

```bash
pnpm changeset version
```

This consumes pending `.changeset/*.md` files, updates each affected package's `package.json` version, regenerates per-package `CHANGELOG.md` files, and updates the lockfile.

Capture which packages and versions changed:

```bash
git diff --stat
git diff -- '**/package.json'
```

Note the new version of each bumped package — these become the tag names later.

### 3. Run checks

Run the project's gates — lint, typecheck, tests, and build. All must pass before committing.

### 4. Commit and push

Stage the version bumps, the regenerated `CHANGELOG.md` files, the consumed (deleted) `.changeset/*.md` files, and the lockfile. Commit message format:

- Single package bumped: `Release <package-name>@<version>`
- Several packages bumped: `Release <package-name>@<v1>, <other-package-name>@<v2>` — or a short summary like `Release 2026-04-27` if the list runs long.

Push to the default branch.

### 5. Ask the user to publish

**npm publish never runs from continuous integration** — no publish token lives in CI to leak. And it never runs from the agent either: prepare everything up to the publish, then the user runs the publish locally, with the npm one-time password as the gate.

Tell the user to run, from the repo root, the publish command listed above for each bumped package. Publishing pushes the package to npm and creates its per-package git tag (`<tag-prefix><version>`).

For prerelease cycles, no extra flag is needed — `changeset publish` reads `.changeset/pre.json` and tags the npm release with the active pre tag (alpha/beta/rc) instead of `latest`.

**Never run the publish command yourself** — npm publish requires the user's one-time password. Wait for the user to confirm they've published before continuing.

After they confirm, fetch the new tags locally:

```bash
git fetch --tags
```

### 6. Create one GitHub release per bumped package

For **each** package bumped in step 2, repeat 6a–6d, using the package's release-tag prefix listed above.

#### 6a. Find the previous tag for that package

```bash
git tag --list '<tag-prefix>*' --sort=-version:refname | head -2
```

The first entry is the new tag just created; the second (if any) is the previous release for comparison. If there is no previous tag (first release of that package), use the repo's first commit (`git rev-list --max-parents=0 HEAD`) as the base.

#### 6b. Analyze changes in depth

Do not just copy the CHANGELOG. Study the actual changes to understand what they mean for users.

1. **Dependency changes first** — diff the package's `package.json` between previous and new tag. `peerDependencies` bumps are the highest-impact breaking change because they gate who can install the package at all (e.g. raising a peer dependency from `>=7` to `>=8` blocks every user on version 7). Flag these immediately.
2. **Public API diff** — diff the package's public entry point for added/removed exports.
3. **Filter commits to the package's path**:
   ```bash
   git log <prev-tag>..<new-tag> --oneline -- <package-dir>/
   ```
4. **List merged PRs in the window**:
   ```bash
   gh pr list --search "is:merged merged:>=<prev-tag-date>" --json number,title,author --limit 100
   ```
5. **Read every relevant PR's body** — PR bodies contain author-written summaries, migration instructions, and context that titles and diffs alone don't provide:
   ```bash
   gh pr view <number> --json body,title --jq '.title + "\n---\n" + .body'
   ```
   Run these in parallel (all PR reads in a single message) for efficiency. Filter to PRs that touched the package's directory.
6. **Read the changed source code** when a PR description is missing or unclear — don't assume what a change does from the title alone.

#### 6c. Compose release notes

Use the section Changesets just appended to the package's `CHANGELOG.md` as the skeleton — it is already grouped by bump type. Then enrich with the structure below, including only sections that apply:

- `## Breaking Changes` — narrative subsections explaining each breaking change, what it replaces, and what users need to do. Order by impact: **dependency requirement changes first**, then behavioral or API changes. Include code examples showing before/after when helpful.
- `## New Features` — bullet points with **bold title**, PR number in parens, and a one-line description drawn from the PR body.
- `## Bug Fixes` — bullet points with PR number and linked issue closes (e.g. "Closes #123").
- `## What's Changed` — full PR list with author links:

```
* <title> by @<author> in https://github.com/<org>/<repo>/pull/<number>
```

End with:

```
**Full Changelog**: https://github.com/<org>/<repo>/compare/<prev-tag>...<new-tag>
```

For a package's first release, replace the compare URL with a link to the new tag:

```
**Full Changelog**: https://github.com/<org>/<repo>/commits/<new-tag>
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

Always **single-quote the tag** — a scoped-package tag contains `@` and `/`, which the shell will otherwise misinterpret. Pass notes via HEREDOC to preserve formatting. Run releases sequentially per bumped package.
