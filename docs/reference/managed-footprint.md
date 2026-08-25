# The managed footprint

Most of what the workflow writes, it owns outright: generated, gitignored, and
replaced on every sync. Three files are different. `.claude/settings.json`,
`.gitignore`, and `package.json` are yours, and sync reaches into each of them
to keep a small, named set of things true. This page is the whole list.

## The settings it enforces

`.claude/settings.json` is your file. Sync enforces exactly the keys below and
leaves every other key alone, including your own hook registrations and the rest
of your permissions block.

| Setting | Value | Why |
| --- | --- | --- |
| `model` | `claude-fable-5[1m]` | Everything that needs taste runs on the one model that has it. |
| `effortLevel` | `high` | How hard the model thinks before it acts. The rules are written for this setting. |
| `alwaysThinkingEnabled` | `true` | Thinking is never skipped, however small the step looks. |
| `autoCompactEnabled` | `false` | You decide when to compact the session's context. Automatic compaction would take that moment away, and the moment is the whole craft. |
| `autoMemoryEnabled` | `false` | Everything the agents read is generated from your configuration and content, so nothing should accumulate outside them. |
| `skillListingBudgetFraction` | `0.02` | Caps how much of the context window the list of available skills may take. |
| `permissions.defaultMode` | `auto` | The one permissions key the package manages. |
| `statusLine` | A command running `.claude/statusline.sh` | The status line, including the context bar you watch during a session. |
| `hooks` | Three registrations | Listed below. |

The first six are assumptions the whole workflow is written against, and they
travel with the package version: sync rewrites each one on every run, and
changing one is a release, not a project decision. `$schema` is filled in when
it is missing, so your editor knows the file, and your own value is left alone.

### The hooks it registers

| Hook | Runs | Timeout |
| --- | --- | --- |
| `PreToolUse`, matching `Bash` | `.claude/hooks/block-git-stash.sh` | 10 seconds |
| `PreToolUse`, matching `Agent` | `.claude/hooks/isolation-guard.sh` | 10 seconds |
| `SessionEnd` | `.claude/hooks/session-end-sweep.sh` | 60 seconds |

Sync re-asserts each of these on every run: a group already pointing at the same
script is replaced, and everything else under `hooks` survives untouched.

Every managed setting that points at a generated script is wrapped in an absence
guard:

```sh
[ -x "$CLAUDE_PROJECT_DIR"/.claude/statusline.sh ] && exec "$CLAUDE_PROJECT_DIR"/.claude/statusline.sh; exit 0
```

So a fresh clone that has not run an install yet still opens a working session,
with the status line and the hooks quietly doing nothing until the first sync.

If the file is not valid JSON, or holds something other than an object, sync
refuses to guess and tells you to fix it first.

## The ignore entries it maintains

Generated files never enter your history. Sync keeps one block in `.gitignore`:

```
# >>> seasoned-skills (managed block, do not edit) >>>
...
# <<< seasoned-skills <<<
```

The block carries the generated paths, compacted: a whole folder for each
generated skill, one for the shaping assets, and single files otherwise.
Anything your own ignore rules already cover stays out of it. Two more entries
are there for files nothing generates, but which the workflow promises stay out
of your history.

| Entry | What it covers |
| --- | --- |
| `.claude/skills/<name>/` | One entry per generated skill folder. |
| `.claude/hooks/block-git-stash.sh` | The stash guard. |
| `.claude/hooks/isolation-guard.sh` | The worktree isolation guard. |
| `.claude/hooks/session-end-sweep.sh` | The session-end sweep. |
| `.claude/statusline.sh` | The status line. |
| `.claude/seasoned-skills-manifest.json` | The list of everything generated. |
| `CLAUDE.md` | The standing instructions. |
| `shaping/assets/` | The assets shaping documents load. |
| `requests-from-meetings/assets/style.css` | The stylesheet meeting records load. |
| `/demo-videos/*/*.mp4` | The finished demo video every assembly copies beside its screenplay. |
| `requests-from-meetings/config.local.json` | Per-user meeting settings. |

Being listed is not the promise. Being actually ignored is, and a later negation
or a nested ignore file can un-ignore a listed path. So sync asks git itself,
with `git check-ignore`, adds whatever is missing to its block, and asks again.
If a path is still visible after that, sync fails and names it, because
something in your ignore files is deliberately re-exposing it.

Glob entries are the one exception. Sync verifies real pathnames, and a glob
stands for a family of files rather than one, so it is listed without ever being
asked about. The plain paths beside it still are.

## The one script it wires

| Script | What it becomes |
| --- | --- |
| `prepare` | `seasoned-skills sync`, appended to whatever you already have. |

Sync asserts this entry on every run. An empty `prepare` becomes
`seasoned-skills sync`; an existing one becomes `<your command> &&
seasoned-skills sync`; one that already mentions the command is left exactly as
it is.

It is deliberately your own script rather than a package lifecycle hook. The
pinned package manager blocks dependency lifecycle scripts by default, and a
sync that silently does not run is worse than no sync at all. This one entry is
why a fresh clone and a version bump both end with the workflow current.

A repository with no `package.json` is left alone. Creating one is the install's
job, not sync's.

## Where to go next

[What a project receives](what-a-project-receives.md) covers everything sync
writes outright. [Commands](commands.md) covers the sync itself.
