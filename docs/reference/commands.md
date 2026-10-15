# Commands

Nine commands, all through one binary. The package is installed as a
dependency of your project, not globally, so the binary is not on your PATH. Run
every command from your project's root as `pnpm exec seasoned-skills <command>`.
In a new worktree, run `pnpm install` first. Three of them work on a lane. A
lane is one named workspace for one piece of work, with its own worktree, ports,
databases, and env files, so two pieces of work never collide on this machine.

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
| `ledger` | Write to this session's ledger, and read back what is in force, search it, or print it whole. |

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
`pnpm exec seasoned-skills doctor` tells you which of those you are looking at.

| Flag | What it does |
| --- | --- |
| `--book <path>` | Vendor the one commercial book from your own compiled copy, a folder of numbered markdown chapters with images. Without it, the distilled account written for this workflow stands in. |
| `--force` | Re-download sources that are already present. |

## seasoned-skills provision

Set up an isolated worktree lane. What a lane gets comes from the `provisioning`
table in your configuration, which is where each repository declares what it
owns.

```sh
pnpm exec seasoned-skills provision search-filters
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
in between. So every session keeps its ledger and its working files in
`.sessions/<session id>/` inside your project's main checkout, the one your
worktrees branch from. Run from a worktree, the command still prints the
folder in the main checkout, so every lane of one session writes to the same
place. The helper agents a session delegates to share its session id, and so
its folder.

Run it from your project's own checkout or one of its worktrees. In a lane
that spans other repositories, a checkout of another repository resolves to
that repository's main checkout instead. A repository whose git directory
lives outside its checkout, as a submodule, a bare repository with worktrees,
or a separate git directory does, has no main checkout to hold the folder, so
the command prints why and exits 1.

The session id comes from the `CLAUDE_CODE_SESSION_ID` variable Claude Code
sets for every command it runs. Outside a Claude Code session, or with a value
that is not a session id, the command prints why and exits 1 without creating
anything.

`.sessions/` is in the managed ignore block, so nothing in it ever enters your
history. A folder lives as long as Claude Code keeps the session's transcript,
the file a session is resumed from, because a session can be picked up again
weeks later. Claude Code keeps transcripts in its projects directory,
`projects/` inside `$CLAUDE_CONFIG_DIR` or `~/.claude` without it, which holds
one project directory per working directory. When the command finds this
session's transcript in one of them, it writes the projects directory's path
into the folder, in a `.projects` file, so `sweep --sessions` knows where to
look.

When no transcript turns up, because the session keeps none or the
configuration is not the one Claude Code is using, the command still creates
the folder and prints its path, and says on stderr that the folder records no
projects directory. Sweep keeps a folder like that, so delete it yourself once
you no longer need it.

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
deletes old transcripts on its own schedule, and once a session's transcript is
gone, the session can no longer be resumed. Sweep lists a folder as expired
once none of the project directories in the projects directory its `.projects`
file names holds the transcript, wherever in there Claude Code moved it, as it
does when a session enters or leaves a worktree. Sweep reads that projects
directory twice, so a transcript caught in the middle of a move keeps its
folder, and `--remove` removes exactly the expired folders. Whenever sweep
cannot tell, because a folder records no projects directory or a place the
transcript could be cannot be read, it keeps the folder and lists it with the
reason, leaving it to you. Sweep looks at nothing in `.sessions/` but folders
named like a session id, so anything else you keep there stays.

One limit comes from trusting the recorded path. If you move Claude Code's
configuration directory and a fresh one later appears at the old path, sweep
removes the folders of sessions that have not asked for their folder since the
move. A session that asks again records the new location.

Each flag belongs to one kind of leftover, and sweep refuses a combination it
cannot honor instead of ignoring part of it: two kinds at once, `--kill` or
`--lane` with `--sessions`, or `--remove` without it all print why and exit 1.

| Flag | What it does |
| --- | --- |
| `--browsers` | List the automated-browser processes your user account runs, with their ages and kinds. Exits 1 while any of your session's or an ended session's are alive, or when they cannot be listed. |
| `--lane-processes` | List every process your user account runs from inside a lane's worktree, whatever its name. Exits 1 when they cannot be listed. |
| `--sessions` | List the session folders whose transcript Claude Code no longer keeps, and the ones sweep keeps because it cannot tell, each with the reason. Exits 1 when an expired folder cannot be removed, when `.sessions/` cannot be read, or when the checkout has no main checkout to hold session folders. |
| `--kill` | Kill your session's own processes and those of ended sessions, each by its exact process id. Browsers are listed again afterwards. |
| `--remove` | With `--sessions`: remove the expired session folders, then list again. |
| `--lane <lane>` | With `--lane-processes`: only that lane's processes, named by its directory name. |
| `--hook` | With `--lane-processes` or `--sessions`: run quietly as the session-end hook, never blocking the session from ending. For lane processes it reads the hook payload and acts only when the session is truly over; session folders are removed whenever any session ends, since an expired folder belongs to no session that could come back. Without `--kill` (lane processes) or `--remove` (session folders) it does nothing; the generated hook passes them. |

## seasoned-skills ledger

Keep this session's ledger: the record of what was decided, what the session
learned, and where the work stands, so the session can find its way back
after a compaction (Claude Code summarizing the conversation to free room).
The record is one database file, `ledger.db`, in the session's folder, the
one `session-folder` prints. The first write creates it. It accepts new
entries and refuses every edit and every delete, whoever asks and through
whatever tool.

Every entry is one of three kinds. A decision governs the work and says who
decided it. A finding is something learned about the product and says where
it came from. Progress is where the work stands. A new decision or finding
can replace an older one of its own kind; the older one stays readable,
marked with what replaced it. An entry is in force until something replaces
it, and progress is never replaced.

On its own, `ledger` prints what is in force: every decision in force,
newest first, with who decided it, who wrote it, and when; the last ten
progress entries whole; and one line counting the findings in force and the
replaced ones. Findings are reached by searching. In a list, a time is the
time of day for today's entries and the date and time for older ones; where
one entry is printed, it is the full local stamp with its offset.

Every `ledger` command runs from your project's root or one of its
worktrees, like `session-folder`, so all the agents in one session share one
record. Outside a Claude Code session a write fails, and a read needs
`--session`. Reading a session with no record yet prints
`No ledger yet in this session.` and exits 0.

The ledger needs Node 22.16 or later, the first Node whose built-in SQLite
has full-text search. On an earlier Node every `ledger` command prints
`The ledger needs Node 22.16 or later.` and exits 1 before creating
anything, the compaction hook prints nothing, and every other command keeps
working.

| Flag | What it does |
| --- | --- |
| `--session <id>` | Read that session's record instead of the current one's, by its session id. Nothing is created for an id with no folder. Before a subcommand it is refused; each read takes its own after its name. |
| `--hook` | Run as the compaction hook. It reads the session from the hook payload on stdin, prints the in-force view fitted under 9,500 characters, prints nothing when there is no record, and always exits 0. The progress entries and the findings line come first, each entry cut to its first line and 200 characters. Decisions fill the rest, newest first and only whole, followed by how many older ones did not fit. A decision too long to fit on its own shows as one line pointing at `ledger show`. |

### seasoned-skills ledger decision

Record something that now governs the work. Only the orchestrator, the main
agent you talk to, records decisions, so `--as` is always `orchestrator`.
The text arrives on stdin, through a quoted heredoc that ends at a line that
is exactly `ENTRY`, so the shell never runs any of it:

```sh
pnpm exec seasoned-skills ledger decision --as orchestrator --by person <<'ENTRY'
Every agent in the session writes to the same record.
ENTRY
```

The command answers with the entry's number, kind, and time, such as
`#47 decision, 2026-10-14 14:02:11 -03:00`, and nothing else. The time comes
from the database's clock. Empty text, or a terminal instead of piped text,
is refused, and the text is kept exactly as it arrives, less the heredoc's
trailing newline.

| Flag | What it does |
| --- | --- |
| `--as <writer>` | Who is writing. Required, and always `orchestrator` for a decision. |
| `--by <who>` | Who decided it: `person` or `agent`. Required. |
| `--replaces <number>` | The decision this one replaces, by its number, with or without a leading `#`. A decision replaces only a decision that exists and nothing has replaced yet. |

### seasoned-skills ledger finding

Record something learned about the product, with where it came from. Any
agent records findings, including a subagent, the helper agent with one
task that the orchestrator launches, under its task's name. Any writer can
replace a finding with a corrected one, so a subagent that disproves a
finding records the correction with the source that disproved it.

```sh
pnpm exec seasoned-skills ledger finding --as sqlite-research --source 'node -e on Node 22.22' <<'ENTRY'
node:sqlite prints an ExperimentalWarning on every run on Node 22; Node 24.21 prints none.
ENTRY
```

| Flag | What it does |
| --- | --- |
| `--as <writer>` | Who is writing: `orchestrator`, or the subagent's task name. Required. |
| `--source <where>` | Where it came from: a file and line, a command and what it printed, a page, a test. Required. |
| `--replaces <number>` | The finding this one replaces, by its number, with or without a leading `#`. |

### seasoned-skills ledger progress

Record where the work stands: what was launched and under which id, on which
branch, what a check returned. Only the orchestrator records progress. It
answers like the other writes, and its text arrives the same way.

| Flag | What it does |
| --- | --- |
| `--as <writer>` | Who is writing. Required, and always `orchestrator` for progress. |

### seasoned-skills ledger search

Search every entry, in force or replaced, for any of the words `<words...>`,
in each entry's text and its source. The words are plain text, never search
syntax: every argument is split on whitespace, and `node:sqlite`, `#418`, a
hyphen, or `OR` is just a word. Entries matching more of the words come
first, then the newest. Each result shows its number, kind, writer, time,
source, and an excerpt of its text, and a replaced entry says what replaced
it. It prints the 20 best matches, then how many more there are.

| Flag | What it does |
| --- | --- |
| `--session <id>` | Search that session's record instead of the current one's. |

### seasoned-skills ledger show

Print one entry whole, with its source and its line of replacements both
ways: what it replaced and what replaced it. A replaced entry says so
plainly, with the number of the entry that replaced it. The entry's number
`<number>` takes a leading `#` or none.

| Flag | What it does |
| --- | --- |
| `--session <id>` | Read that session's record instead of the current one's. |

### seasoned-skills ledger print

Print the whole record as plain text, oldest first, with every entry whole:
every replaced entry says what replaced it, and every replacement says what
it replaced. It is the one read that grows with the session, meant for a
person who wants to read the record end to end, copy it, or keep it.

| Flag | What it does |
| --- | --- |
| `--session <id>` | Print that session's record instead of the current one's. |

## Where to go next

[Configuration](configuration.md) documents every key these commands read.
[What a project receives](what-a-project-receives.md) covers what a sync
actually writes, and [the managed footprint](managed-footprint.md) covers the
few things it changes in your own files.
