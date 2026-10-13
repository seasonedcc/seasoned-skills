# Running a session

You shape the work; agents build it. This page is the manual for what you
actually do while they build. It is a short list, and that is the point:
you are away from the keyboard for most of the effort, working on
something else or not there at all, and the craft is knowing which
moments not to miss. Those moments come down to two watches, one
discipline, and what happens after the goal.

## Starting the build

Open a fresh Claude Code session on the project and run `/model` to pick
Opus: the session you are about to start is the orchestrator, the one
session that coordinates the whole build, and its entire job is judgment.
Then type `/goal` followed by the goal text pasted from the shaping
document, the written project described in
[The way of working](the-way-of-working.md). `/goal` is a feature of
Claude Code, not of this package: it keeps the session working until the
goal is met, checking after every stop whether the goal holds and telling
the session to continue if not. That checking process matters to you
personally, and the second watch below explains why.

## When the context fills up

The context window is everything the agent is working from at a given
moment, and it is finite. Left alone, it fills quietly, and the work
degrades before anything visibly fails: the orchestrator starts leaning
on its own compressed memory of things instead of the sources, and it
will happily keep going past the point where its output suffers. The fix
is compaction, which means summarizing the session so far to free space.

You don't run it. The package sets Claude Code to compact on its own, for
the orchestrator and for every subagent (the helper agents it delegates
the building to), once the context reaches around 300,000 tokens — a
little under a third of the window.

What happens next needs nobody in the room either. A compacted session's
memory of the effort is a summary, and summaries drift, so the
orchestrator's standing instructions send it straight back to its ledger
before it takes another step. The ledger is the file where the effort's
durable facts and lessons live, kept current at every moment precisely
because compaction can land at any point. From there the orchestrator
checks what it remembers against the real sources of truth (the
codebase, the pull requests, the shaping document), and where the
summary and the sources disagree, the sources win.

The status line at the bottom of the session shows a context bar:
green while the context is under a quarter full, yellow up to a third,
red beyond. Automatic compaction should already have fired at around 30
percent, so a red bar means it did not: compact by hand with `/compact`.
Don't let it wait. A questionnaire sits patiently until you answer it,
but a red context bar degrades the work while it sits.

## The first watch: usage limits

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

## The second watch: the questions

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

One more thing a goal leaves behind: the self-improvement pass has filed
what it learned as issues, on your project and on this package. None of
them is a task waiting for you. They're raw material for your next
shaping session, and the workflow's rules change only when a shaping
session decides they should.
