# Running a session

You shape the work; agents build it. This page is the manual for what you
actually do while they build. It is a short list, and that is the point:
you are away from the keyboard for most of the effort, working on
something else or not there at all, and the craft is knowing which
moments not to miss. Those moments come down to three watches, one
discipline, and what happens after the goal.

## Starting the build

Open a fresh Claude Code session on the project and run `/model` to pick
Fable: the session you are about to start is the orchestrator, the one
session that coordinates the whole build, and its entire job is judgment,
which is Fable's strength. Then type `/goal` followed by the goal text
pasted from the shaping document, the written project described in
[The way of working](the-way-of-working.md). `/goal` is a feature of
Claude Code, not of this package: it keeps the session working until the
goal is met, checking after every stop whether the goal holds and telling
the session to continue if not. That checking process matters to you
personally, and the third watch below explains why.

One more thing the package has already set up for you: the status line at
the bottom of the session shows a context bar, and Claude Code's
automatic compaction is switched off in every project the package
manages. Both exist for the first watch.

## The first watch: the context window

The context window is everything the agent is working from at a given
moment, and it is finite. Left alone, it fills quietly, and the work
degrades before anything visibly fails: the orchestrator starts leaning
on its own compressed memory of things instead of the sources, and it
will happily keep going past the point where its output suffers. The fix
is compaction, which means summarizing the session so far to free space.
Deciding when to compact is yours, for a concrete reason: the package
switches automatic compaction off, so the compaction you run is the only
compaction there is.

The rhythm:

- Once the orchestrator's context passes roughly 22 percent full, a
  little before the context bar in the status line turns yellow, start
  looking for a moment to compact without interrupting much. The best
  moment is usually while the orchestrator waits on its subagents, the
  helper agents it delegates the building to: nothing of its own train of
  thought is lost while it is waiting anyway.
- Once it passes roughly a third full (33 to 36 percent, the bar red),
  stop waiting for a good moment. Interrupt and compact anyway.

The numbers are ballpark; the gesture is what matters. Start hunting for
the moment before the bar turns yellow, and never let it sit red.

The ritual, step by step:

1. Type `/prepare-for-compaction`. Asking in plain words works exactly as
   well ("Is your ledger up to date? I want to compact your context
   now"), because the orchestrator knows this ritual; the command is just
   the shortest way to say it. The ledger is the file where the effort's
   durable facts and lessons live, and the orchestrator now brings it
   current if it is behind, then answers plainly that compacting is safe.
2. When that answer comes, type `/compact`.
3. Immediately queue the next message, before the compaction finishes:
   `/reground`, or in plain words, "Please reground yourself after
   compaction". Claude Code holds a queued message and sends it the
   moment the running step completes, so regrounding fires the instant
   compaction ends, even with nobody in the room. Queue it and walk away.

Regrounding matters because a compacted session's memory of the effort is
a summary, and summaries drift. `/reground` sends the orchestrator back
to the ledger and the real sources of truth (the codebase, the pull
requests, the shaping document) before it takes another step, and where
the summary and the sources disagree, the sources win.

Of everything on this page, this watch is the one that cannot wait for
you. A questionnaire sits patiently until you answer it; a red context
bar degrades the work while it sits.

## The second watch: usage limits

This way of working is token-intensive: a goal effort runs for hours,
with the orchestrator and many building agents working the whole time.
Plan on more than one Claude Code Max 20x subscription. How many is
yours to learn from experience, and it depends on how much of the
workflow you adopt and how much you shape and build; there is no number
to give you here beyond "more than one".

The watch itself is simple. Keep an eye on the subscription's usage limit
as it approaches. When it nears, open a second Claude Code session in
another tab and run `/login` there to switch to another subscription. The
effort continues where it was; nothing about the build is lost in the
switch.

## The third watch: the questions

While a goal runs, Claude Code's goal checker keeps the effort moving:
whenever the orchestrator stops, the checker looks at whether the goal is
met, and if it is not, it tells the orchestrator to continue. That is
what makes the autonomous build possible, and it has one consequence for
you. If the orchestrator asks you something as plain conversation and
stops to wait, the goal checker runs it over: "Goal not met. Please
continue." The orchestrator continues without your answer, and the
question is lost.

Questionnaires are the exception: a question asked through Claude Code's
questionnaire form pauses the goal checker until it is answered. So the
workflow instructs orchestrators to ask through questionnaires whenever
you may be away, and that is why your part of this watch is simple: check
in from time to time, answer whatever questionnaire is waiting, and step
away again. When you are at the keyboard and actively conversing, it is
plain conversation, like working with anyone.

A well-shaped project asks few questions either way. If a build is
peppering you with questionnaires, the lesson is usually about the
shaping, not the build.

## One discipline, held as firmly as the watches

Never run or test the product mid-effort, and never micromanage the
orchestrator. Test only after the orchestrator considers the work done
and the goal is marked achieved. Mid-effort, the product is half-built by
design, so what you would find is noise; and steering the build by hand
undoes the point of having shaped the project well enough to build
without you.

When the finished result misses your expectations, judge carefully what
actually went wrong before deciding what to do about it, because there
are two very different cases. Usually the build did what the shaping
document allowed, and the lesson belongs to the next shaping session.
Sometimes, though, the model service itself was having a degraded day,
and the work is simply below the bar the same setup normally clears; that
is not a shaping lesson, and reshaping around it would teach the wrong
thing.

## After the goal

Verification leans on the demo videos first. Generate them: the workflow
films two narrated recordings of the finished work, a highlights cut of
about five minutes and a full-length walkthrough of everything in scope.
Watch the full walkthrough end to end, and test by hand only what feels
off. A full demo that plays well means the process held; move toward
deployment. Running the project locally to poke at it happens sometimes,
but the lean is videos first.

One more thing waits for you after a goal: the self-improvement pass has
filed its findings as draft pull requests on your project and issues on
this package. Reviewing them is yours, and merging them is only ever
yours: a change to the way of working reaches nobody until you have read
it and agreed.
