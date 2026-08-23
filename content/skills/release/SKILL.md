---
name: release
description: Cut a release — scope the span since the last release, deeply study every merged pull request in it, write release notes in which every sentence traces to a merged change, run the gates and audits, and treat the publish as the deliberate final act. Use when the user asks to release, cut a release, publish, ship a new version, ship what's on main, release to production, or write release notes.
---

# Release

What a release *is* depends on what the project ships — a deployed product releases by publishing a GitHub Release that deploys production; a published package releases by versioning packages and publishing them to npm. This project's mode follows the spine below.

## The spine

Every release, whatever the mode, rests on three rules:

- **Study the span deeply.** Enumerate every merged PR between the last release and the release point and read each one: the body, and enough of the diff to describe the change truthfully. This is a deep study, not a skim — never write notes from titles alone. A wide span can fan the reading out to subagents that each return a distilled account of their PRs, but every grouping and judgment is made personally after reading those accounts.
- **Trace every sentence.** Nothing in the release text may claim anything this study did not establish. Every sentence traces to a merged PR.
- **The publish is the deliberate final act.** Everything before it — notes, versions, badges, audits — is preparation, and reversible; the publish is not. Run every gate before it, and never publish over an open question or an adjudication the user has not seen.

{{release-mode}}
