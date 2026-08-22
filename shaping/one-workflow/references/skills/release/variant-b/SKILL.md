---
name: release
description: Cut a production release — pick the next v<N> tag, deeply study everything merged since the last release, write curated release notes grouped by shaping project, solved meeting requests, and topic, stamp solved requests-from-meetings entries with Released badges, audit everything through a pre-release PR, then publish the GitHub Release that triggers the deploy. Use when the user invokes /release, asks to cut a release, release to production, ship what's on main, or write release notes.
---

# Release

A release is a GitHub Release tagged `v<N>` against a commit on main, and publishing it is what deploys production — the `deploying` skill owns the pipeline mechanics; read it before starting. This skill owns everything that happens before the publish button: what the release says, how the requests-from-meetings records learn that their asks shipped, and the audit that gates the whole thing.

## Scope the release

- The next tag is the highest existing `v<N>` plus one: `git tag -l | sort -V`.
- The span is `v<last>..origin/main`. Enumerate every merged PR in it — `git log v<last>..origin/main --first-parent --oneline` for the merge commits, then `gh pr view <n>` for each — and read each one: the body, and enough of the diff to describe the change truthfully in the product's own words. This is a deep study, not a skim; the notes below are only as good as this reading. A wide span can fan the reading out to subagents that each return a distilled account of their PRs, but every grouping and judgment below is made personally after reading those accounts.
- Nothing in the release text may claim anything this study did not establish. Every sentence traces to a merged PR.

## Write the description

The description has two parts, in this order: the curated notes, then GitHub's auto-generated notes. The auto-generated part is appended automatically at publish time (see *Publish*) and is always last — the curated part is the release.

Structure of the curated part:

1. **Opening** — a few sentences on what this release means for the people running their operation on the product. Plain product language, no internal vocabulary.
2. **One section per shaping project** worked on in the span: the project's name as the heading, everything built under it described together, and a link to the full shaping document so readers can track the thinking — `https://github.com/<org>/<repo>/blob/main/shaping/<slug>/index.html`.
3. **Requests from meetings** — every meeting-request entry this release solves, each with a one-line description and a link to the entry's record: `https://github.com/<org>/<repo>/blob/main/requests-from-meetings/<meeting>/index.html#<entry-id>`. A solved request is mentioned here whether or not the work happened inside a shaping project.
4. **Everything else, grouped by topic** — changes that belong to no shaping project and solve no recorded request, clustered by what they touch (imports, billing, docs, …), never listed as a flat PR dump.

Hold the copy to the `copywriting` skill's bar and write for an external reader. The curated part must be considerably richer than the auto-generated notes — if a section reads like the PR-title list below it, rewrite it.

## Judge the meeting requests

At release time — and only at release time; a meeting-parsing PR never stamps a badge — walk **every entry in every `requests-from-meetings/*/index.html` that does not yet carry a Released badge** and judge it against the release's content. The standard is deliberately lenient: stamp the badge when the release plausibly addresses the ask, even without certainty that it solves it for good. If it does not, the subject will resurface in future meetings and be recorded again; an over-eager badge costs nothing, a missing one hides shipped work.

For each solved entry, add the badge inside the entry's `.entry-head`, right after its kind label:

```html
<a class="label label-released" href="https://github.com/<org>/<repo>/releases/tag/v<N>">Released · v<N></a>
```

The link points at a release that does not exist while the PR is open; publishing with exactly that tag right after the merge is what makes it resolve. Each badged entry also appears in the description's *Requests from meetings* section, so the record links the release and the release links the record.

## The pre-release PR — the audit gate

Releases here are big, so the release is audited as a PR before it is published. Open one PR containing the badge edits, with the complete draft release description as the PR body (curated part only — note where the auto-generated notes will be appended). The audit, on the PR, before merge:

- Read the full description end to end against the span's PRs: no claim without a merged PR behind it, no merged user-facing change left undescribed.
- Open every link — shaping documents, request entries — and confirm each resolves and says what the citing sentence claims.
- Re-justify every badge added: name the PR(s) that address the entry's ask. Also re-check a sample of entries left unbadged — the misses matter as much as the stamps.
- Every question raised to the user during the span has an answer, and every finding surfaced during the span has a disposition they have seen. Publishing is the irreversible act, and it never happens over an open adjudication.
- `python3 requests-from-meetings/verify.py --all` still exits clean after the badge edits.
- The usual gates: `pnpm run lint`, `pnpm run tsc`, `pnpm run test:unit`.
- The infrastructure the span assumes is already in production: run the `deploying` skill's pre-deploy infrastructure review over the span, and hand the founder any newly-required env keys with their values. This is the release's job because the release is what deploys, and it belongs in the audit because the founder needs the list before the publish, not after it. CI passing on this PR says nothing about it — the gates stub the vendor URLs they need.

Merge only when the audit and CI both pass, and hold the publish until the founder confirms the settings are in place.

## Publish

Invoking `/release` is the authorization to publish — publishing deploys production, and the user knew that when they typed it; never ask for a further go. Once the pre-release PR has merged with the audit and CI both passing:

```bash
gh release create v<N> --target <pre-release-merge-sha> --title "v<N>" \
  --notes-file <curated-notes.md> --generate-notes
```

`--generate-notes` combined with a provided body appends the auto-generated notes after the curated text — that ordering is the point. Target the pre-release PR's merge commit so the deployed code and the badge state ship together.

Then verify: the release page shows the curated notes first and the auto-generated notes last, the badge links resolve to the release, and the `Deploy to production` workflow run completes green (`gh run watch`).

A green run is not a working site. The release is not done until the `deploying` skill's post-deploy smoke test has run against the production URL for its full five minutes and come back clean.
