# Running a session

You shape the work; agents build it. This page is the manual for what you
actually do in between: the handful of moments a build genuinely needs a
person, and how to spot them without hovering.

A build starts by typing `/goal` followed by the goal text pasted from the
shaping document, the written project described in
[The way of working](the-way-of-working.md). `/goal` is a feature of Claude Code, the coding tool the
workflow runs in; this package does not ship it. From that moment your
whole job is three watches. You are away from the keyboard for most of the
effort, and the craft is knowing which moments not to miss.

## The first watch: the context window

The context window is everything the agent is working from at a given
moment, and it is finite. Left alone, it fills quietly, and the work
degrades before anything visibly fails: the orchestrator (the top-level
session coordinating the build) starts leaning on its own compressed
memory of things instead of the sources, and it will happily keep going
past the point where its output suffers. The fix is compaction:
summarizing the session so far to free space. Deciding when to compact is
yours.

It is yours for a concrete reason: the package switches Claude Code's
automatic compaction off in every project it manages. The compaction you
run is the only compaction there is.

The rhythm:

- Once the orchestrator's context passes roughly 22 percent full, a
  little before the context bar in the status line turns yellow, start
  looking for a moment to compact without interrupting much. The best
  moment is usually while it waits on its subagents, the helper agents it
  delegates the building to.
- Once it passes roughly a third full (33 to 36 percent, the bar red),
  interrupt and compact anyway.

The numbers are ballpark; the gesture is what matters. Start hunting for
the moment before the bar turns yellow, and never let it sit red.

The ritual, step by step:

1. Ask whether the ledger is up to date by typing
   `/prepare-for-compaction`. The ledger is the file where the effort's
   durable facts and lessons live; the orchestrator brings it current if
   it is not, then answers plainly that compacting is safe.
2. When that answer comes, compact.
3. Immediately queue the next message: please reground after compaction
   (`/reground`). Queuing it right away means regrounding fires the
   instant compaction ends, even with nobody in the room.

Regrounding matters because a compacted session's memory of the effort is
a summary, and summaries drift. `/reground` sends the orchestrator back to
the ledger and the real sources of truth before it takes another step.

## The second watch: usage limits

This way of working is token-intensive. Plan on more than one top-tier
subscription, and learn your own number from how much of the workflow you
adopt and how much you shape and build.

The watch itself is simple: keep an eye on the subscription's limit as it
approaches. When it nears, open a second session in another tab and log in
to another subscription.

## The third watch: the questions

Whenever you may be away, the orchestrator asks for your input through
questionnaires, because only a questionnaire pauses the goal loop; a plain
question typed into the conversation gets run over by "goal not met,
continue." When you are at the keyboard and conversing, it is plain
conversation.

A well-shaped project asks few questions either way. Check in from time to
time to unblock, answer what is waiting, and step away again.

## One discipline, held as firmly as the watches

Never run or test the product mid-effort, and never micromanage the
orchestrator. Test only after the goal is marked achieved. When the result
misses your expectations, the lesson usually belongs to the next shaping
session; degraded model service happens too, so judge carefully what
actually went wrong before deciding which it was.

## After the goal

Verification leans on the demo videos first: generate them (the workflow
produces narrated recordings of the finished work), watch the full
walkthrough, and test by hand only what feels off. A full demo that plays
well means the process held; move toward deployment. Running the project
locally happens sometimes, but the lean is videos first.
