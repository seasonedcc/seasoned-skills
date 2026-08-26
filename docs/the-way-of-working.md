# The way of working

An idea arrives. Some time later, the work ships. This page teaches
everything in between: how the idea becomes a written, reviewed project,
how AI agents build it end to end, what done means, and what happens once
the goal is met. All of it runs inside Claude Code, Anthropic's coding
agent: every session this page describes is a Claude Code session, working
from the standing instructions and skills this package generates into the
project. Read the page whole, in order, because each part exists to serve
the ones around it. The manual for what you personally do while a build
runs is [Running a session](running-a-session.md), and
[Adopting the workflow](adopting-the-workflow.md) covers bringing all of
this to your own codebase.

## Why this exists

We were maintaining the same way of working in three repositories, by
hand. Every lesson was learned once and taught to only one project. The
copies quietly drifted apart, and the person maintaining them was the only
bridge between them: a rule sharpened in one repository reached the others
when they remembered to carry it over, which is to say, sometimes.

This package ends that. The goals that survive from its founding project
are concrete:

- **One source of truth.** Nothing the workflow produces is written by
  hand inside a project. The instructions agents read are generated from
  the package plus the project's own configuration and content, and
  regenerated on every upgrade.
- **A lesson written once reaches every project** on its next upgrade, by
  default rather than by memory.
- **A new project costs an install**, not an afternoon of copying from
  whichever sibling feels most current and pruning what does not apply.
- **Differences between projects are configuration, never forks.**
  Legitimate difference (a different stack, a practice one project is not
  ready for) gets a home in the configuration, which leaves drift nowhere
  to hide.

## What the workflow believes

When a peer asks how AI agents can produce a codebase you would actually
want to maintain, the honest answer has three parts, and they are the
three convictions everything below is built on. None of them is a feature
you install; they are how the workflow thinks.

### Agents build on a curated foundation

The stack and the patterns our agents work in were curated by hand for
five years before AI entered the picture: which framework, how business
logic is organized, how database tables are designed, how tests are
written, what a good pull request looks like. The agents did not invent
the standards they follow; they inherited them, the way a new teammate
inherits a codebase with taste already in it.

That is why the first thing this workflow does in a project is generate
skills: step-by-step guides for recurring work, one per practice, that
every session reads before touching the code they govern. A project that
adopts the workflow's stack conventions receives skills for its database
design, its business-logic folder, its route structure, its background
jobs, down to how dates are formatted. The point is not that any one rule is clever. The point is that
an agent starting cold gets the same inheritance a person would take five
years to build, and the workflow exists to keep that inheritance current
in every project at once, so a standard sharpened anywhere becomes the
standard everywhere.

### Everything that needs taste runs on Fable

Wherever the work calls for judgment, we run Fable, the strongest Claude
model, because taste is exactly what it has and we have not found its
match anywhere else. Concretely, Fable runs the shaping sessions, the
session that coordinates every build, the final quality judgment on every
piece of work before it merges, and the hardest problems when a build
hits one. Everyday building runs on Opus, and wide review sweeps run on
Sonnet; the judgment always stays with Fable, and nothing merges on a
lower tier's word alone.

The second half of this conviction matters as much as the first: the
taste is codified in skills. When a session learns what good looks like
for some recurring piece of work, that learning is written down as a
skill the package ships, so good judgment is not one person's habit or
one lucky session's output. It is a file every project generates, read by
every session that does that kind of work.

### The context window is cared for

The context window is everything an agent is working from at a given
moment, and it is finite. As it fills, the quality of the work degrades
quietly, starting somewhere around a quarter to a third full, long before
anything visibly fails: the agent starts leaning on its own compressed
memory of things instead of the sources, and it will happily keep working
past that point. We are frankly paranoid about this, and the paranoia is
written into the workflow rather than left to habit, in three places:

- **Work is sliced so no single agent carries too much.** Every delegated
  task is sized to land near a third of the window by the time it
  finishes, reading and test runs included. A task that would honestly
  cost more gets split before it starts.
- **Every long effort keeps a ledger**: a running file of the durable
  facts and lessons the effort must not lose, kept current at every
  moment rather than reconstructed when it is needed.
- **A person, not the agent, decides when to compact.** Compaction means
  summarizing the session so far to free space, and the workflow switches
  Claude Code's automatic compaction off. The numbers, the rhythm, and
  the exact ritual of that watch are the heart of
  [Running a session](running-a-session.md).

## How work enters the system

The premise comes from Shape Up, Basecamp's product development method:
well-planned bigger batches beat a treadmill of tasks. A treadmill of
tasks is what most backlogs produce: an endless stream of small items,
each cheap to start, none of them adding up to a thought-through whole,
with the real decisions made implicitly, one ticket at a time. This
workflow deliberately batches work up into shaped projects instead, and
makes the projects as big as the shaper can hold in their head, because
cohesion comes from framing the problem well, not from keeping scope
small.

So the default is: work goes through shaping. There are two entry points
into shaping and exactly two kinds of work that skip it.

### Entry point one: a raw idea

You bring an idea straight to a shaping session by typing `/shaping` in a
Claude Code session on the project. What follows is a working
conversation, and it is worth knowing what it feels like, because it is
nothing like writing a spec alone.

The session wears two hats at once. As an interviewer it asks one
question at a time, each carrying its own recommended answer, and it
keeps going until the two of you have walked every branch of the decision
tree: not a form to fill in, a conversation that refuses to leave a
question vague. As the senior engineer in the room it grounds every
technical claim in the project's actual code, runs real queries against
real data when one settles a question, and researches external facts on
the web instead of asking you. When something is genuinely uncertain, it
runs a spike: a quick, throwaway attempt whose only output is the finding
that goes into the document. The code from a spike is never kept.

The session lives in a git worktree of its own behind a draft pull
request, and the shaping document is the session's only memory: it grows
at every point where something is settled, so you watch it take shape as
you talk, and a session months later resumes from the document alone.

### Entry point two: meeting recordings

Requests do not only arrive as ideas. Customer calls, software reviews,
and working meetings are full of asks, and they evaporate unless someone
records them precisely. The `requests-from-meetings` skill turns meeting
recordings into permanent request documents: one page per meeting, each
entry tied to timestamps, saying who asked, in what context, and what was
on screen, with the speaker's exact words quoted verbatim in the
meeting's own language and translated. Every quote is verified
mechanically against the transcript, so months later someone who was not
there can trust what was asked.

The records capture three kinds of entries: explicit requests, observed
pain points (friction that surfaced without being voiced as a request),
and current workflows to replicate, because a demonstrated way of working
is often more precise than the voiced ask. The documents state plainly
that they are records of what was asked, never commitments to build it.

A batch of these records, sometimes joined by existing GitHub issues, is
the raw material a shaping session starts from: the session reads them
first and brings the customers' own words into the room.

### The two exceptions

**Urgent fixes.** The Andon cord, in the Lean Manufacturing sense: in a
Toyota factory, any worker can pull a cord that stops the line when they
see a defect, no permission needed, because a defect moving down the line
costs more than the stop. Here, anyone can pull it, and the fix runs now.
No command guards it; you ask for the fix in plain conversation, and it
runs as a task with full rigor: the complete Definition of Done (the
checklist a change must pass before it counts as done, covered below) and
the full delegation machinery. The only thing an urgent fix skips is the
shaping. Urgency is never a reason to lower the quality bar; it is only a
reason to skip the queue.

**Quick mode.** Small polish to work already done: "Can you make the
button primary instead of ghost?" It runs only when a person explicitly
asks for it by typing `/quick`; the agent never selects it on its own and
never suggests it. It qualifies exactly as the shipped quick skill rules
it: a small fix or polish to something already built, disqualified the
moment it needs a new route, a new table or migration, a new permission,
or a new screen or machine-facing endpoint, along with any disqualifiers
the project's own configuration adds. A disqualified task runs under the
full Definition of Done even though `/quick` was typed, and says so
before starting. What quick mode trades away is the ritual that only pays
off on larger changes: it keeps the gates that catch real breakage (lint,
typecheck, the affected tests, one review pass) and drops the rest,
including the self-improvement pass.

Everything else goes through shaping. Holding that line is what keeps the
treadmill from reasserting itself one reasonable-sounding task at a time.

## Where we part from Shape Up

Four departures, each with its own reason.

- **Appetites are dropped.** In Shape Up, an appetite caps how much time
  a project is worth, and the constraint shapes the solution. Agents do
  the building now, so build time is no longer the scarce ingredient the
  appetite existed to ration. No solution here is chosen because it is
  the version that fits in six weeks.
- **Betting is gone.** Shape Up pools shaped pitches and bets on a few of
  them each cycle. Here, opening a shaping session is itself the decision
  to do the project; there is no separate betting table, and a shaping
  document carries exactly one bit of status: built, or not.
- **Interdependent projects merge.** Two projects whose builds would
  fight over the same ground are one project pretending to be two, and
  running them in parallel detonates during the build. Every session
  checks the not-yet-built documents for this, and merges rather than
  sequencing one behind the other or shelving one.
- **Shaping now takes longer than building.** With agents doing the
  building, the build became the fast part, and the careful human work
  moved to the front of the cycle. This is the deepest change: the
  person's craft is now almost entirely in the shaping and in the
  judgment, and almost not at all in the typing.

## What shaping produces

One document per project, at `shaping/<project-title>/index.html` in the
project's repository. Before it is anything else, the document is a
feedback instrument. The business rules a build depends on live in the
heads of the people who run the business, more of them than any one
shaper holds, so the plan cannot be trusted until those people have read
it end to end and had their chance to say "that's not how it works here",
before the build bakes a wrong rule in. That sets the document's bar: a
non-technical operator reads the whole thing without hitting a wall. A
toggle hides every technical detail, and both variants print to PDF.

The anatomy, in reading order:

1. **Title and essence**: one sentence anyone in the company could
   repeat.
2. **Status**: built, or not. Nothing else is tracked.
3. **The framing**, fully non-technical: the problem as one specific
   story of one person hitting the wall, with their verbatim words quoted
   from the meeting records where the records carry them; how the work
   gets done today and where that breaks; the outcome test, which is how
   everyone will know the new way is working better; and why now.
4. **The shape**: what gets built, in plain language and rough hand-drawn
   sketches, kept deliberately low fidelity so readers see where their
   own corrections go. It contains a walkthrough that replays the
   framing's story through the new solution in slow motion, step by step,
   so the reader can check that the story actually ends better. It names
   every trap found during shaping, and here the workflow is strict: a
   trap the document names without solving is not a warning, it is the
   trap handed to the build with a label on it, so each one carries its
   solution. And it names the no-gos: the things this project is
   deliberately not doing, written down so nobody quietly does them.
5. **The goal**: the text that starts the build, covered next.

The goal is a thin ignition key, never a second spec. It fits in Claude
Code's `/goal` limit of 4,000 characters, and the document renders it
with a live character count and a copy button. It carries the mission
sentence, an instruction to read the shaping document in full as the
single source of truth, the acceptance criteria (the framing's outcome
test, the walkthrough replayed in the shipped product, and a closing
audit of the complete implementation against the document, section by
section, with every shortfall fixed before the goal is called met), and
the few constraints only the goal can carry, such as the base branch.
Everything else belongs in the document, where the readers who can
correct it will see it.

A shape that feels done is not yet done. Before a document is ready,
independent readers audit it: every claim it makes about the existing
system is verified against the code it describes, every quoted request is
verified against its source, and the document is read whole for sections
that contradict each other. Then a fresh reader with no context plays the
role of the future build's coordinator, reads everything, and reports
whether it could actually build from the document alone; what it would be
forced to guess becomes the last round of fixes. Only then does the human
review that precedes every build mean what it should.

## From document to build

A person starts the build by opening a fresh Claude Code session on the
project, picking Fable, and typing `/goal` followed by the goal text
pasted from the document. `/goal` is Claude Code's own feature, not
something this package ships: it keeps the session working until the goal
is met, and it is what makes the multi-hour autonomous build possible.
From here on, the machinery below runs the build, and the person's much
smaller job is the whole of [Running a session](running-a-session.md).

### The orchestrator

The session the goal was typed into acts as the orchestrator: the one
session that plans the work, splits it into independent pieces, delegates
each piece, reads the resulting changes, and rules on quality. It runs on
Fable, because everything it does is judgment. It does not type the code
itself; agents type, the orchestrator decides. Each delegated piece goes
out with written instructions saying what to build, which files belong to
it and which belong to its siblings, and where to stop, and each is sized
so the agent doing it lands near a third of its context window by the
time it finishes. The orchestrator treats every claim an agent reports as
unverified until it has checked the work itself: gates are re-run, diffs
are read, and nothing advances on an agent's word alone.

The orchestrator also keeps the effort's ledger, the running file of
durable facts introduced earlier, which is what lets the effort survive
its own context being compacted several times along the way.

### Lanes: isolated copies of the project

Independent pieces of work run in parallel, and parallel work needs
isolation. Each piece runs in a lane: its own git worktree (a separate
checkout of the repository on its own branch), provisioned by
`seasoned-skills provision` with its own databases, its own ports, and
its own copies of the environment files, all derived from the resource
table the project's configuration declares. Two lanes never share
uncommitted code or data, so their dev servers, test runs, and browser
sessions run at the same time without colliding, and a finished lane is
swept away by `seasoned-skills teardown` with everything it owned.

### What done means

Every project's Definition of Done is generated into its standing
instructions, so every session reads it without anyone remembering to
bring it up. The core criteria, in plain words:

- **The gates are green**: the lint, typecheck, and test commands the
  project's configuration declares, all passing.
- **No leftover comments**: the notes the work wrote to itself along the
  way never ship, and a code comment survives only where the code alone
  genuinely cannot explain what is happening.
- **The adversarial review passed**, covered next.
- **The documentation moved with the change**: a change to a command, a
  flag, a configuration key, or the way of working itself is not done
  until the documentation says so, in the same change.
- **The lessons were mined**: the self-improvement pass, covered below,
  ran before the task was declared finished.

Projects add criteria through their options. A project with web screens
requires every screen to be reachable by an end-to-end test and every new
screen to ship demo data in the same change; a project with a
machine-facing side holds it to parity with the product. The point of the
list is not any single item. It is that "done" is a defined word, checked
the same way every time, immune to the optimism of whoever just finished
the work.

### The review loop

Every change lands through a pull request, and before it merges it passes
an adversarial review: one that tries to break the change rather than
bless it. The review deliberately runs against the draft pull request
instead of a bare diff, because a pull request carries its description
and discussion alongside the code, and a review that never reads them
repeats questions already answered and misses claims already disputed.

The loop reads everything first, then judges the big picture before any
detail: should this change exist at all, is the approach right, is there
a simpler design under which the problem disappears, and is the result
actually good rather than merely working. Only then does it hunt for
defects, from independent angles (a line-by-line read, a check of every
behavior the diff removed, a trace of every caller of every changed
function, the project's own conventions), and every candidate defect is
verified before it counts: a finding must name the concrete input or
state that triggers it, or it is dropped. The orchestrator loops the
review until it is satisfied with the quality, not until the list of
findings happens to be empty.

### Merging

Agents merge reviewed lane work into the goal's own branch as they go, so
the build keeps moving without a person in the loop. Merging into the
project's default branch is a person's act: the orchestrator opens the
pull request and stops, unless the project deliberately opts its goals
into agent merges. A green test run or an approved review is never read
as permission to merge.

### Questions

When the orchestrator genuinely needs a decision only a person can make,
it asks through a questionnaire, a form Claude Code shows the person,
because that is the one way to pause a goal effort while its person is
away. A well-shaped project needs few of them.
[Running a session](running-a-session.md) covers this watch from the
person's side.

## Self-improvement runs on its own

Nobody starts it, and nobody has to remember it. At the end of every task
outside a goal, and once per goal when the goal is met, the workflow
mines the finished effort for durable lessons. Only quick mode skips this
pass.

The mining reads the real record, not memory: the ledger, the
conversation, the pull request threads. The person's own corrections rank
above every other source, because anything the person had to say twice is
something the system failed to absorb the first time. After that come
failures traced to their root cause, then wins that would not be
rediscovered cheaply. A lesson is codified only when it clears a real
bar: it will matter beyond the task that taught it, a future session
reading it would act differently, and it is worth the attention it will
cost every session that reads it from now on. Finding nothing worth
codifying is a valid outcome, stated plainly.

What clears the bar travels on two channels at once. A pull request lands
the lesson in the project's own content, where the next sync weaves it
into the generated skills. And a detailed issue goes to this package's
repository, because a lesson that holds everywhere should be written once
for everyone; those issues are the package's record of demand, and the
package changes only through its own shaping, never by applying a
consumer's request verbatim. Both arrive as drafts, and only the person
merges them: a change to the way of working is a change to how a team
works, and it reaches no teammate before a person has read it.

## Verification and shipping

Verification of a finished goal starts with demo videos, not with a test
plan. The workflow films two narrated videos of every finished scope,
from a screenplay, against the product seeded with demo data: a
highlights cut of about five minutes that tells one story (the struggling
moment, the gesture that answers it, the outcome), and a full-length
walkthrough of everything in scope, as long as the scope is. Their
audience is internal stakeholders learning the scope and giving feedback:
someone who was not in the room watches them to understand what was built
and to say where it is wrong. For the person who ran the effort, the full
walkthrough is the verification: watch it end to end, and hand-test only
what feels off. [Running a session](running-a-session.md) covers that
practice.

Shipping is the part of the practice most visibly in motion, so this
section describes today honestly rather than teaching a settled rule.
Today, shipping usually means cutting a GitHub release; the default
branch is not production. The likely near-term model is three tiers:
everything lands on the default branch, a staging environment takes the
work on an explicit action, and production is cut by release. The pull
toward that model is real, and it comes from trust: the more the agents
build alone, the more stakeholders need a place to try the work before it
ships. But it is a direction, not yet a rule, and the workflow
deliberately allows more than one way of working with releases while it
settles.

The rest belongs to the vision: a closed loop in which the running
product is observed, users talk to the AI itself, and feedback from the
outside world opens the next shaping session on its own.

## One project, start to finish

To make the arc concrete, follow one imaginary project through it.
Monday, a customer call is recorded. The recording is parsed into a
request document, and one entry records a reporting screen users keep
asking for, in the customer's own words, with the spreadsheet they showed
on screen. A shaping session takes that request, interrogates it, and
ends in a shaping document: the problem as the customer's story, the
shape of the solution with rough sketches, the walkthrough replaying the
story with a better ending, the traps found and solved ahead of time, the
things deliberately not being done. A reviewer who knows the business
reads it and corrects one wrong assumption before any code exists.

The document's goal is pasted into `/goal` in a fresh Claude Code session
running Fable. The orchestrator splits the work into lanes, agents build
and test in parallel worktrees, pull requests are adversarially reviewed
and merged into the goal's branch, and the person checks in a few times a
day to compact the context and answer the occasional questionnaire, as
[Running a session](running-a-session.md) teaches. When the goal is met,
the self-improvement pass files what the effort taught. The person
watches the demo videos the workflow generated, tries by hand the one
interaction that felt off, and cuts the release. Whatever the finished
work reveals about what should have been shaped differently becomes raw
material for the next shaping session.

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
