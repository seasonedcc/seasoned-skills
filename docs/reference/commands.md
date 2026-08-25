# Commands

Seven commands, all through one binary. In a project that has installed the
package, run them with your package manager: `pnpm exec seasoned-skills sync`.

| Command | What it does |
| --- | --- |
| `install` | One-time interactive scaffold, then a sync and a doctor report. |
| `sync` | Regenerate every generated file from your configuration and content. |
| `doctor` | Check this machine for the tools your configuration needs. |
| `corpus` | Build the shaping reference library into this machine's cache. |
| `provision` | Set up an isolated worktree lane. |
| `teardown` | Remove a lane and everything it owns. |
| `sweep` | Kill leftover browsers or lane processes. |

## seasoned-skills

The binary on its own prints the help. One flag stands outside the commands.

| Flag | What it does |
| --- | --- |
| `-V, --version` | Print the installed package version. |

## seasoned-skills install

Adopt the workflow. This is a one-time interactive scaffold: it asks about
every option the workflow gives no default, then writes the files your project
commits. `seasoned-skills.config.ts` states every option explicitly, so reading
it is reading the whole declaration. Beside it come the content directory, the
calibration file, the shaping folder, the meeting-requests data folder, and the
registers whichever options you turned on need.

Nothing that already exists is ever overwritten. Files the install skips are
printed as `kept existing <path>`.

If this machine has no current shaping reference library, the install asks for
your own compiled copy of the one commercial book and builds the library before
finishing. An empty answer takes the distilled account written for this
workflow instead.

It finishes by running a sync and printing the doctor report, so the first thing
you see after adopting is the state of your machine.

Running it in a project that already has a configuration fails with a pointer to
`sync` instead.

## seasoned-skills sync

Regenerate everything. Sync is the only moving part after adoption: it reads
your configuration and your content files, writes every generated file, deletes
the ones a configuration change stopped generating, and keeps the managed
ignore entries, settings keys, and `prepare` script true. It is idempotent, so
running it twice changes nothing the second time. It prints one line saying how
many files it wrote.

Your project's `prepare` script runs it on every install, which is why a fresh
clone and a version bump both end with the workflow current.

Sync also runs the doctor checks in a warning-only mode. A missing tool prints
a `warning:` line naming the tool, why the workflow wants it, and how to install
it. Missing tools never fail a sync.

When sync cannot run at all, it fails loudly. A configuration that does not
load, a content file nothing would ever read, a missing content directory: each
of those prints the complete list of problems, and then the generated workflow
is removed down to the repair kit, which is the package's own skill plus a
minimal instructions file carrying the error report. Nothing half-generated is
left behind to be mistaken for a working workflow. Fix the inputs and sync
again.

## seasoned-skills doctor

Check this machine against what your configuration asks for. Doctor derives its
checklist from the options you turned on, so a project with no web pages is
never told to install a browser tool. Each finding names the missing binary, why
the workflow needs it, and how to install it.

Doctor is advisory everywhere. It reports and points; it never blocks, because
enforcement belongs to the gates that actually need the tools.

It also reports the state of this machine's shaping reference library: present
and current, stale because a different package version built it, or missing
altogether. Without a loadable configuration it says so and still reports the
library.

## seasoned-skills corpus

Build the shaping reference library into this machine's cache. The shaping skill
teaches from the books and posts the method comes from, and those texts never
enter any repository. They are fetched from their authors' sites, verified, and
kept in a per-machine cache that each project's sync weaves into its generated
shaping skill.

Run it on a new machine, or after a package upgrade that moved the library.
`seasoned-skills doctor` tells you which of those you are looking at.

| Flag | What it does |
| --- | --- |
| `--book <path>` | Vendor the one commercial book from your own compiled copy, a folder of numbered markdown chapters with images. Without it, the distilled account written for this workflow stands in. |
| `--force` | Re-download sources that are already present. |

## seasoned-skills provision

Set up an isolated worktree lane. A lane is one named workspace for one piece of
work: its own git worktree, its own ports, its own databases, its own env files,
so two pieces of work never collide on this machine. What a lane gets comes from
the `provisioning` table in your configuration, which is where each repository
declares what it owns.

```sh
seasoned-skills provision review-fixes
```

Provisioning is idempotent. Re-running keeps the lane's existing allocation and
never reseeds a database that already exists, so it is safe to run again after
an interrupted setup.

The lane name is required, and it also names the worktree directories.

| Flag | What it does |
| --- | --- |
| `--repo <path>` | A declared repository this lane covers, by its exact declared path. Repeatable. Without it the lane covers the first declared repository alone. |
| `--branch <branch>` | The branch the worktrees check out. Defaults to `worktree/<lane>`. |
| `--base <ref>` | The base for a new branch. Defaults to the origin's HEAD branch. |
| `--skip-provision` | Create the worktrees and nothing else. |
| `--skip-seed` | Provision without seeding. |
| `--fresh-seed` | Re-anchor the seed's demo data to today. |

## seasoned-skills teardown

Remove a lane across every declared repository: its processes, its cache-store
index, its whole database family including derived names, and its worktrees.
Processes are killed by exact process id, and only the ones running from inside
the lane's own worktrees.

Teardown refuses a lane whose worktree has uncommitted changes, and it never
touches the branch. Your commits survive teardown; your uncommitted work is
your own to deal with first.

| Flag | What it does |
| --- | --- |
| `--force` | Remove the lane even when a worktree has uncommitted changes. |

## seasoned-skills sweep

Kill what a session left running. Sweep covers two kinds of leftovers, and it
needs to be told which: with neither `--browsers` nor `--lane-processes` it
prints what to choose and exits 1.

Every kill is by exact process id, after listing what it found. Nothing is ever
matched by name or pattern, so a permanently running service on your machine is
never at risk.

| Flag | What it does |
| --- | --- |
| `--browsers` | List surviving automated-browser processes. Exits 1 while any are alive. |
| `--kill` | With `--browsers`: kill each survivor by its exact process id, then list again. |
| `--lane-processes` | Terminate the processes running from inside worktree lanes, each by its exact process id after listing. |
| `--lane <lane>` | With `--lane-processes`: only that lane's processes. |
| `--hook` | With `--lane-processes`: run quietly as the session-end hook. Reads the hook payload, sweeps only when the session is truly over, and never blocks the session from ending. |

## Where to go next

[Configuration](configuration.md) documents every key these commands read.
[What a project receives](what-a-project-receives.md) covers what a sync
actually writes, and [the managed footprint](managed-footprint.md) covers the
few things it changes in your own files.
