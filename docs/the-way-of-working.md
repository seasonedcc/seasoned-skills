# The way of working

An idea arrives. Some time later, the work ships. This page tells the
story of everything in between: how the idea becomes a written, reviewed
project, how AI agents build it end to end, and what happens once the goal
is met. It is meant to be read whole. The manual for what you personally
do while a build runs is [Running a session](running-a-session.md), and
[Adopting the workflow](adopting-the-workflow.md) covers bringing all of
this to your own codebase.

## What the workflow believes

Three convictions run through everything below. None of them is a feature
you install; they are how the workflow thinks.

**Agents build on a curated foundation.** The stack and the patterns our
agents work in were curated by hand for years before AI entered the
picture. The agents did not invent the standards they follow; they
inherited them. The workflow exists to keep that inheritance current in
every project at once, so a standard sharpened anywhere becomes the
standard everywhere.

**Everything that needs taste runs on the one model that has it.**
Wherever the work calls for judgment (shaping, reviewing, deciding what a
change really needs), we run the one model that has the taste for it, and
we write that taste down into skills: step-by-step guides for recurring work
that ship with the package. Good judgment is not one person's habit; it is
a file every project generates.

**The agent's context window is cared for.** The context window is
everything an agent is working from at a given moment, and it is finite.
As it fills, the quality of the work degrades quietly, long before
anything visibly fails, and an agent will happily keep working past that
point. So the workflow slices work so that no single agent carries too
much, keeps a ledger (a running file of the durable facts a long effort
must not lose), and puts a person in charge of deciding when to compact
(summarize the session so far to free space). The mechanics of that watch
are the heart of [Running a session](running-a-session.md).

## The goals it serves today

The workflow's founding project set out to end a specific failure: every
project kept its own hand-made copy of the way of working, every lesson
was taught to only one of them, and the person maintaining the copies was
the only bridge between them. The goals that survive from that project are
concrete:

- **One source of truth.** Nothing the workflow produces is written by
  hand inside a project. The instructions agents read are generated from
  the package plus the project's own configuration and content, and
  regenerated on every upgrade.
- **A lesson written once reaches every project** on its next upgrade,
  by default rather than by memory.
- **A new project costs an install**, not an afternoon of copying from
  whichever sibling feels most current and pruning what does not apply.
- **Differences between projects are configuration, never forks.**
  Legitimate difference (a different stack, a practice one project is not
  ready for) gets a home in the configuration, which leaves drift nowhere
  to hide.

## How work enters the system

The premise comes from Shape Up, Basecamp's product development method:
well-planned bigger batches beat a treadmill of tasks. Work is
deliberately batched up into shaped projects rather than broken down into
tasks.

Shaping is working an idea into a written document that says what to
build and why: precisely enough that agents can build from it without its
author in the room, and honestly enough that a reviewer can spot what is
wrong before anything gets built. Two entry points feed it:

- **A raw idea**, brought straight to a shaping session: a working
  conversation with the AI that interrogates the idea and ends in a
  shaping document.
- **Meeting recordings**, one or a batch, sometimes joined by existing
  issues. They are parsed into precise request documents, and those
  requests become shaping raw material.

Exactly two kinds of work skip shaping:

- **Urgent fixes.** The Andon cord, in the Lean Manufacturing sense:
  anyone can pull it, and the fix runs now. It runs as a task with full
  rigor, meaning the complete Definition of Done (the checklist a change
  must pass before it counts as done) and the full delegation machinery.
  The only thing it skips is the shaping.
- **Quick mode.** Small polish to work already done, and only when a
  person explicitly asks for it by typing `/quick`; the agent never
  selects it on its own. It qualifies exactly as the shipped quick skill
  rules it: a small fix or polish to an existing surface,
  disqualified the moment it needs a new route, a new table or migration,
  a new permission, or a new product surface — a screen or a
  machine-facing endpoint alike — along with any disqualifiers the
  project's own configuration adds.

Everything else goes through shaping.

## Where we part from Shape Up

Three departures, each with its own reason.

- **Appetites are dropped.** In Shape Up, an appetite caps how much time
  a project is worth. Agents do the building now,
  so build time is no longer the scarce ingredient the appetite existed
  to ration.
- **Betting is gone.** Shape Up pools shaped pitches and bets on a few of
  them each cycle. Here, opening a shaping session is itself the decision
  to do the project; there is no separate betting table.
- **Shaping now takes longer than building.** With agents doing the
  building, the build became the fast part, and the careful human work
  moved to the front of the cycle.

## From document to build

A finished shaping document carries its own ignition: a goal, ready to
paste. The build starts when a person types `/goal` with that text, and
from there agents carry the work.

The top-level session acts as the orchestrator: it plans, delegates, and
reads the results, but does not type the code itself. Building happens in
parallel lanes, each an isolated copy of the repository (a git worktree),
with its own databases and ports where the project declares them, so
independent pieces of work never collide. Every change lands through a pull request with the
tests green and an adversarial review (one that tries to break the change
rather than bless it) completed before it merges. Agents merge reviewed
lane work into the goal's own branch as they go; merging into the
project's default branch stays a person's act unless the project
deliberately opts its goals into agent merges.

While all of this runs, the person is mostly away from the keyboard,
watching for a few moments that matter. That job is the whole of
[Running a session](running-a-session.md).

## Self-improvement runs on its own

Nobody starts it, and nobody has to remember it. At the end of every task
outside a goal, and once per goal when the goal is met, the workflow mines
the finished effort for durable lessons. What it finds travels on two
channels at once: a pull request landing the lesson in the project's own
content, and a detailed, anonymized issue on the package's repository, so
a lesson that holds everywhere can be written once for everyone. Only
quick mode skips this pass.

## Shipping, and where it points

Shipping is the part of the practice most visibly in motion, so this
section describes today honestly rather than teaching a settled rule.

Today, shipping usually means cutting a GitHub release; the default branch
is not production. The likely near-term model is three tiers: everything
lands on the default branch, a staging environment takes the work on an
explicit action, and production is cut by release. The pull toward that
model is real (the more the agents build alone, the more stakeholders need
a place to try the work before it ships), but it is a direction, not yet a
rule.

The rest belongs to the vision: a closed loop in which the running product
is observed, users talk to the AI itself, and feedback from the outside
world opens the next shaping session on its own.

## One project, start to finish

To make the arc concrete, follow one imaginary project through it. Monday,
a customer call is recorded. The recording is parsed into request
documents, and one request describes a reporting screen users keep asking
for. A shaping session takes that request, interrogates it, and ends in a
shaping document: the problem in the customer's words, the shape of the
solution, the traps found and defused ahead of time, the things
deliberately not being done. A reviewer reads it and corrects one wrong
assumption before any code exists.

The document's goal is pasted into `/goal`. The orchestrator splits the
work into lanes, agents build and test in parallel, pull requests are
reviewed and merged, and the person checks in a few times a day to answer
questions and compact the context. When the goal is met, the
self-improvement pass files what the effort taught. The person watches the
demo videos the workflow generated, tries by hand the one interaction that
felt off, and cuts the release. Whatever the finished work reveals about
what should have been shaped differently becomes raw material for the next
shaping session.

## The vision

The goals above are today's. The vision is further out, and it is worth
stating whole.

We are building toward one thing: AI agents doing all the work of product
development. Pulling requirements out of meetings, issues, user feedback,
and the running product's behavior. Shaping, building, releasing, and
watching what ships. Today we still bring the ideas and rule on the
quality. Real autonomy means agents decide what to shape and shape it
themselves, then decide what ships, to which audience, and how fast the
rollout goes. Feedback from the outside world — the running product
observed, users talking to the AI itself — starts the next shaping session
on its own. Two doors stay open to us for good: anyone can start a shaping
session, and every shaping document waits for human review before the
build starts. But coming up with the work stops being something only we
do.
