# Commands

Eight commands, all through one binary. In a project that has the package
installed, run them with your package manager: `pnpm exec seasoned-skills sync`.
Three of them work on a lane. A lane is one named workspace for one piece of
work, with its own worktree, ports, databases, and env files, so two pieces of
work never collide on this machine.

| Command | What it does |
| --- | --- |
| `install` | One-time interactive scaffold, then a sync and a doctor report. |
| `sync` | Regenerate every generated file from your configuration and content. |
| `doctor` | Check this machine for the tools your configuration needs. |
| `corpus` | Build the shaping reference library into this machine's cache. |
| `provision` | Set up an isolated worktree lane. |
| `teardown` | Remove a lane and everything it owns. |
| `session-folder` | Print the folder where this Claude Code session keeps its files, creating it. |
| `sweep` | List leftover browsers, lane processes, or session folders, and clean up only what your Claude Code session or an ended one left behind. |

## seasoned-skills

The binary on its own prints the help. So does `-h, --help`, on the binary and
on every command below. One other flag stands outside the commands.

| Flag | What it does |
| --- | --- |
| `-V, --version` | Print the installed package version. |

## seasoned-skills install

Adopt the workflow. This is a one-time interactive scaffold: it asks about
every option the workflow gives no default, then writes the files your project
commits. `seasoned-skills.config.ts` states what the interview settled, with
the optional layers you declined absent and `provisioning` left as a commented
block to fill in. Beside it come the content directory, the shaping folder,
and the meeting-requests data folder. With them come the registers your options
need, the content files the stack questions already answered, and a minimal
`package.json` where the repository has none.

Nothing that already exists is ever overwritten. Each new file is printed as
`created <path>`, and each one already there as `kept existing <path>`.

If this machine has no current shaping reference library, the install asks for
your own compiled copy of the one commercial book and builds the library before
finishing. An empty answer takes the distilled account written for this
workflow instead.

It finishes by running a sync and printing the doctor report, so the first thing
you see after adopting is the state of your machine.

In a project that already has a configuration, install still asks its questions,
then refuses and points you at `sync`.

## seasoned-skills sync

Regenerate everything. Sync is the only moving part after adoption: it reads
your configuration and your content files, writes every generated file, deletes
the ones a configuration change stopped generating, and keeps the managed
ignore entries, settings keys, and `prepare` script true. It is idempotent, so
running it twice changes nothing the second time. It prints one line saying how
many files it wrote.

Your project's `prepare` script runs it on every install, which is why a fresh
clone and a version bump both end with the workflow current.

Sync also runs the doctor checks in a warning-only mode. A missing binary or
file prints a `warning:` line naming it, why the workflow wants it, and how to
get it. Nothing missing ever fails a sync.

When sync cannot run at all, it fails loudly. A configuration that does not
load fails on its own, before any content is read. Past that, the content
problems sync can see are reported together: a missing content directory, a
content file nothing would ever read, a content file missing a section its
skill requires. Either way the generated workflow is then removed down to the
repair kit, which is the package's own skill plus a minimal instructions file
carrying the error report. Nothing half-generated is left behind to be mistaken
for a working workflow. Fix the inputs and sync again.

## seasoned-skills doctor

Check this machine against what your configuration asks for. Doctor derives its
checklist from the options you turned on, so a project with no web pages is
never told to install a browser tool. A check is a binary on your PATH or a file
this machine holds, like the demo narrator's model weights. Each finding names
the missing one, why the workflow needs it, and how to get it.

Doctor is advisory everywhere. It reports and points; it never blocks, because
enforcement belongs to the gates that actually need the tools: the lint,
typecheck, and test commands a change has to pass before it lands.

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

Run it on a new machine, and after every package upgrade: the cache records the
version that built it, so any newer version reads as stale.
`seasoned-skills doctor` tells you which of those you are looking at.

| Flag | What it does |
| --- | --- |
| `--book <path>` | Vendor the one commercial book from your own compiled copy, a folder of numbered markdown chapters with images. Without it, the distilled account written for this workflow stands in. |
| `--force` | Re-download sources that are already present. |

## seasoned-skills provision

Set up an isolated worktree lane. What a lane gets comes from the `provisioning`
table in your configuration, which is where each repository declares what it
owns.

```sh
seasoned-skills provision search-filters
```

Provisioning is idempotent. Re-running keeps the lane's existing allocation and
never reseeds a database that already exists, so it is safe to run again after
an interrupted setup.

The lane name `<lane>` is required, and it also names the worktree directories,
so it must be a single directory name: no slashes, and not `.` or `..`.

| Flag | What it does |
| --- | --- |
| `--repo <path>` | A declared repository this lane covers, by its exact declared path. Repeatable. Without it the lane covers the first declared repository alone. |
| `--branch <branch>` | The branch the worktrees check out. Defaults to `worktree/<lane>`. |
| `--base <ref>` | The base for a new branch. Defaults to the origin's default branch. |
| `--skip-provision` | Create the worktrees and nothing else. |
| `--skip-seed` | Provision without seeding. |
| `--fresh-seed` | Under `templateCaching`, rebuild the cached template so a database this run creates is seeded for today. Databases that already exist are untouched, so to reseed a live lane you tear it down and provision it again with this flag. |

## seasoned-skills teardown

Remove a lane across every declared repository: its processes, its cache-store
index, its whole database family including derived names, and its worktrees.
Processes are killed by exact process id, and only the ones that listen on one
of the lane's managed ports, run from inside the lane's own worktrees, and were
started by your Claude Code session or by one that has ended. Teardown names
any port listener it leaves running, and you stop that one yourself by its
process id. Anything else still running in the lane shows up in
`sweep --lane-processes`, and sweep kills only what your session or an ended
one started.

Teardown refuses a lane another live Claude Code session is using. Before it
changes anything, it looks at every process running from inside the lane's
worktrees. If one was started by another Claude Code session that is still
running, or is a Claude Code session itself, teardown names that session and
stops. If it cannot list those processes at all, it stops the same way. It
also refuses a lane whose worktree has uncommitted changes, and it never
touches the branch. Your commits survive teardown; your uncommitted work
is your own to deal with first.

The lane name `<lane>` is required: the lane's directory name alone, the same
name you provisioned it with.

| Flag | What it does |
| --- | --- |
| `--force` | Remove the lane even when a worktree has uncommitted changes or another live session is using it. That session's processes are still left running. |

## seasoned-skills session-folder

Print the absolute path of this session's folder, creating it when it is
missing. A long session's ledger, its scratch files, and its logs have to
outlive a reboot, and the temporary directory Claude Code offers for them does
not: the operating system empties it on restart and ages old files out of it
in between. So every session keeps what it writes in `.sessions/<session id>/`
inside your project's main checkout, the one your worktrees branch from. Run
from a worktree, the command still prints the folder in the main checkout, so
every lane of one session writes to the same place. The helper agents a
session delegates to share its session id, and so its folder.

The session id comes from the `CLAUDE_CODE_SESSION_ID` variable Claude Code
sets for every command it runs. Outside a Claude Code session, or with a value
that is not a session id, the command prints why and exits 1 without creating
anything.

`.sessions/` is in the managed ignore block, so nothing in it ever enters your
history. A folder stays for as long as Claude Code keeps the session's
transcript, the file a session is resumed from, because a session can be
picked up again weeks later. Once the transcript is gone, `sweep --sessions`
removes the folder.

## seasoned-skills sweep

Find what sessions left behind, and clean up what this session may. Sweep
covers three kinds of leftovers, and it needs to be told which: with none of
`--browsers`, `--lane-processes`, or `--sessions` it prints what to choose and
exits 1.

The first two are processes. Sweep finds its candidates first: the automated
browsers your user account runs, by a pattern scoped to the `.agent-browser`
install, and every process your user account runs from inside a lane's
worktree, whatever its name. Then it works out which Claude Code session each
one belongs to.

It looks at the process's ancestry first: the process that started it, the one
that started that, and so on up. A process running anywhere under a Claude Code
session belongs to the nearest one above it. When the ancestry reaches no
running Claude Code session, as with a process whose starter already exited,
the mark decides. Claude Code puts its own process id in the `CLAUDE_PID`
environment variable of every command it runs, and everything those commands
start inherits it. That variable is the mark. Sweep reads it from the process
itself, or from the nearest process above it whose environment it can read.
That sorts every process into one of four kinds:

- **Mine**: started by the Claude Code session running the sweep.
- **Ended session**: started by a Claude Code session that no longer runs. A
  process id that now belongs to a process younger than the one it marked has
  been reused, so that session counts as ended too.
- **Another live session**: started by a different Claude Code session that
  is still running, or a Claude Code session itself.
- **Unmarked**: neither its ancestry nor a mark sweep can read names a
  session. On macOS, the system's own programs and any program that renames
  itself hide their environment, so their mark has to come from a process
  above them.

One case follows from these rules rather than from any session's intent. A
long-lived helper that one session started, such as a tmux server or a shared
daemon, carries that session's mark into everything later started through it,
whichever session asked for it. Once the session that started the helper ends,
sweep counts every one of those processes as an ended session's. `--kill` then
kills them, and so does the session-end hook whenever any session ends. That
includes a dev server another live session started through that helper and is
still using.

Without `--kill`, sweep only lists, naming each process's kind. With it, sweep
kills the first two kinds, each by its exact process id, and never the other
two. An unmarked process is never killed: once the listing has shown you what
it is, stop it yourself by its exact process id. Sweep counts a session as its
own only when it runs under that session, so from a plain terminal, or a shell
that merely inherited some session's mark, nothing counts as mine and only
what ended sessions left behind is killed.

The third is session folders, the ones `session-folder` creates. Claude Code
keeps each session's transcript in its projects directory, `projects/` inside
`$CLAUDE_CONFIG_DIR` or `~/.claude`, and deletes old ones on its own schedule.
A folder expires once no project there holds its session's transcript, since
no session can be resumed from it any more. `--sessions` lists the expired
folders, and `--remove` removes exactly those. Sweep looks at nothing in
`.sessions/` but folders named like a session id, so anything else you keep
there stays. When it cannot read every project's transcripts, or cannot find
the running session's own transcript among them, it counts no folder as
expired: it prints why, removes nothing, and exits 1.

| Flag | What it does |
| --- | --- |
| `--browsers` | List the automated-browser processes your user account runs, with their ages and kinds. Exits 1 while any of your session's or an ended session's are alive, or when they cannot be listed. |
| `--lane-processes` | List every process your user account runs from inside a lane's worktree, whatever its name. Exits 1 when they cannot be listed. |
| `--sessions` | List the session folders whose transcript is gone. Exits 1 when the transcripts cannot be read. |
| `--kill` | Kill your session's own processes and those of ended sessions, each by its exact process id. Browsers are listed again afterwards. |
| `--remove` | With `--sessions`: remove the expired session folders, then list again. |
| `--lane <lane>` | With `--lane-processes`: only that lane's processes, named by its directory name. |
| `--hook` | With `--lane-processes` or `--sessions`: run quietly as the session-end hook, never blocking the session from ending. For lane processes it reads the hook payload and acts only when the session is truly over; session folders are removed whenever any session ends, since an expired folder belongs to no session that could come back. Without `--kill` or `--remove` it does nothing; the generated hook passes them. |

## Where to go next

[Configuration](configuration.md) documents every key these commands read.
[What a project receives](what-a-project-receives.md) covers what a sync
actually writes, and [the managed footprint](managed-footprint.md) covers the
few things it changes in your own files.
