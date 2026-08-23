---
name: shaping
description: Run framing and shaping sessions that end in a shaping document, and answer questions about the method from the verbatim books and posts in references/. Use when framing a raw idea, shaping a project, writing or revising a shaping document under shaping/, working feedback on one back in, breadboarding or drawing fat marker sketches, finding and defusing time bombs (Shape Up's rabbit holes), naming no-gos, or when reasoning about customer demand — jobs to be done, JTBD, the struggling moment, forces of progress, demand-side selling, why people switch. Also the corpus to consult on anything Shape Up covers beyond our process — pitches, appetite, betting tables, scopes, hill charts, scope hammering, deciding when to stop.
---

# Shaping

This skill runs framing and shaping sessions: a human brings a candidate, and the work ends in one document a whole company can read and a build can start from. It also carries the verbatim text of the books and posts the method comes from, at `references/` — built on each machine by the workflow's corpus machinery, never committed. `references/INDEX.md` lists every document and where it came from.

## The shaping process

Our process has two steps and then stops: **framing** — nailing the problem and the outcome — and **shaping** — nailing what we build. "Framing is what we solve, shaping is what we build" (`references/03-articles/pitfalls-when-adopting-shape-up.md`). Everything downstream in _Shape Up_ — the betting table, cycles, scopes, hill charts, deciding when to stop — is outside this process.

Three places where we deliberately part from the corpus. These are our preferences, not Ryan's:

- **No appetite.** The book makes a time budget the creative constraint: "Appetites start with a number and end with a design" (`references/01-shape-up/04-set-boundaries.md`). Agents do our building, so shaping is now the bulk of the work and build time is not the scarce ingredient. Nothing here is bounded by a time budget, and no solution is chosen because it is the version that fits in six weeks. Never ask how much time an idea is worth.
- **No betting, no gates.** _Shape Up_ sends pitches to a betting table, and `references/03-articles/pitfalls-when-adopting-shape-up.md` adds Candidate / Frame Go / Shape Go checkpoints on top. We have neither. Opening a shaping session is itself the decision to do the project. A document carries exactly one bit of status: built or not. Frame-before-shape survives as conversational discipline — at every moment, both of you know whether you are talking about the problem or the solution — and as the document's anatomy, never as a state anyone tracks.
- **Merge, don't parallelize.** The corpus treats tangled interdependencies as a hole to patch inside one project. We also read them across projects: two projects that depend on each other are one project wearing two hats, and they get merged rather than sequenced or shelved. "Size and time bombs" below has the whole rule.

### Sessions

The same ritual opens every session, before the first question:

1. Read the `shaping/` registry in the consuming repo: which documents exist, and which are built.
2. Read this skill's own project section (below): standing principles a repo has settled live there, and they are rulings that bind every session and every document in that repo.
3. Create the new project's folder, or read the existing document **in full**.
4. Re-derive interdependencies against the siblings that aren't built yet.
5. Interview in whatever mode the document's completeness implies. A blank document means framing from zero; a shape with undefused time bombs means going straight at those.

A session lives in a git worktree of its own from the first minute, behind a draft pull request that stays open the whole time, its description kept current as the document grows. The PR's state says who the document is for: **draft** while shaping is in progress, **ready for review** when the user judges it fit to share with the team, **merged** when it is fit for stakeholders. Feedback that arrives after a merge opens the next round on a new branch with a new draft PR. Whatever plumbing the consuming repo needs so its gates ignore `shaping/` (CI filters, lint and type-check exclusions) lands on the base branch through its own PR — a shaping PR only ever carries shaping.

The document is the session's only memory. Write to it at every crystallization point — when something is settled, not sentence by sentence, because "Shaping is not filling in a template" (`references/03-articles/shaping-isnt-writing.md`). Done right, the user watches the document grow as you talk, and a session months later resumes from the document alone.

Feedback rounds are this same session type, seeded with the feedback, whatever channel it arrived by. Map each point to the section it lands in, adjudicate them with the user one at a time, and carry the reasoned declines back into the document alongside the accepted changes — a decline that lives only in a thread gets raised again by the next reader. Then revise, and re-derive the goal. Git is the revision history; the document states current truth only.

### The two hats

Wear both at once.

**The relentless interviewer.** One question at a time, in plain conversation — never a questionnaire or a form widget, because adjudication is a dialogue, not a survey — each carrying your recommended answer. Explore the materials before asking — the demand records, the codebase, the sibling documents — so no question is one the room could have answered for you. When a question turns on an external fact — a code from an industry standard, a regulatory rule, a published reference value — research it on the web instead of asking. Before firing each round of questions, re-read everything the user sent since the previous round — mid-turn messages, images, and answer annotations often settle branches on their own; never ask a question whose answer is already on the table — acknowledge the settled branch and move to the next open one. Keep going until you and the user reach shared understanding, walking each branch of the decision tree.

**The senior engineer in the room.** Shaping without technical depth is the number-one failure mode: "If you try to shape with only PMs and non-technical designers, projects will churn because of the unanswered questions that blow up during build" (`references/03-articles/pitfalls-when-adopting-shape-up.md`). You are that technical person. Ground every technical claim in the consuming repo's actual code — and in its own skills and standing doctrine, which govern contracts a shape must honor or deliberately amend in the open, never silently contradict — and say when you have checked and when you are guessing. Run real queries against real data when one settles a question — framing sessions do this: "You'll sometimes see live SQL queries and people pulling up past customer research data in a framing session to answer a question or narrow down the opportunity" (`references/03-articles/framing.md`). When viability is genuinely in doubt, run a time-boxed **spike** in a throwaway worktree, in the sense the corpus uses the word: "a quick technical effort where you learn what's involved in a task by trying to do it... I'm mostly trying to verify that the task has a stopping point" (`references/03-articles/small-tools-for-shaping.md`). The finding goes into the document; the code is never kept. Shaping ships prose and drawings only — the build starts fresh from the goal.

### Framing

A human always brings the candidate. This skill never ranks a pile of ideas or proposes what to work on next: "Backlogs are a big weight we don't need to carry" (`references/01-shape-up/08-bets-not-backlogs.md`).

What the session does with the candidate is ground it, hard. Read the project's demand records first — wherever the consuming repo keeps what people asked for and where they struggle — and bring their words into the room. Challenge the candidate instead of taking it at face value. Two questions do most of that work: knowing people can't do this today, what are they doing instead, and what's bad about that? (`references/03-articles/discovery-how-to-decide.md`) The calendar request in `references/01-shape-up/04-set-boundaries.md` narrowed from "do everything a calendar does" to "help me see free spaces" only because someone asked the customer *when* she wanted a calendar. Surface the adjacent recorded requests that belong in the same frame, and put them on the table.

Every frame answers three things:

1. **The struggling moment, as one specific story.** "The best problem definition consists of a single specific story that shows why the status quo doesn't work" (`references/01-shape-up/07-write-the-pitch.md`). One person, one moment, in their own words where the records carry them. Not a persona, not a category, not a list of complaints.
2. **The four questions** (`references/03-articles/research-gives-us-the-problem-not-the-answer.md`): What's the current way people do this, without the new solution? When does the current way *not* work? What are they trying to do when it doesn't work? How will they know if the new way is working better? The fourth is the outcome test, and the frame as a whole is "the acceptance test for the whole shape" (`references/03-articles/end-to-end-with-shape-up-a-real-world-case-study.md`).
3. **The business imperative.** Which currency this pays in — money, buzz, morale, or time (`references/03-articles/whats-a-unit-of-impact.md`) — and why now. "For the business to spend time on a problem, the problem has to match something the business cares about" (`references/03-articles/matching-problems-to-business-imperatives.md`).

Two more tools to reach for when the situation calls for them, never as mandatory sections — "there's a difference between a process and a toolbox" (`references/03-articles/small-tools-for-shaping.md`):

- **The four forces**, drawn lo-fi, when adoption risk is real: the push of the situation and the pull of the new way against the anxiety it creates and the habit of the old way. "The push of the situation and the magnetism of the new solution need to be stronger than their anxieties and habits before they will buy" (`references/02-demand-side-sales-101/08-chapter-two-the-frameworks-for-demand-side.md`).
- **Big hire versus little hires**: who approves this once, and who has to choose it again every working day. "When you design a product, you need to build it to be bought and used" (same chapter).

### Size and time bombs

Make projects as **big** as possible. The only bound is comprehension — the shaper and the document's readers have to hold the whole thing in their heads at once. Cohesion comes from the framing, one struggling moment and one outcome test, not from keeping scope small. The book hammers scope down to fit an appetite; we have no appetite to fit, so we don't.

Two dangers wear the same name.

**External time bombs** are interdependencies *between* projects. Two documents whose builds would fight over the same ground are one project pretending to be two, and running them in parallel detonates during the build. Merge them into a single bigger, well-orchestrated project rather than sequencing them or shelving one. Every session scans the not-yet-built documents in the registry for this and puts any join on the table. That is why no document has an interdependencies section: the answer changes as siblings land, so it is derived fresh each session against the registry as it stands.

**Internal time bombs** are what the 2019 book calls rabbit holes — "technical unknowns, unsolved design problems, or misunderstood interdependencies" inside one project (`references/01-shape-up/06-risks-and-rabbit-holes.md`), including the hairball code a concept will have to fight. Hunt them during shaping, while the shape is still cheap to change and a cut costs a sentence instead of a week. "Any rabbit hole that isn't **solved** during shaping is a time bomb that can churn the project" (`references/03-articles/pitfalls-when-adopting-shape-up.md`), so every one the document names carries its solution. A time bomb the document names without defusing isn't a warning; it's the bomb, handed to the build with a label on it.

### Shaping

Shaping is the concept: "the parts, the links between them, the things that are 'in' and the things that are 'out' that make it all work" (`references/03-articles/shaping-isnt-writing.md`). Hold the level of abstraction the corpus insists on — wireframes are too concrete, words alone are too abstract — so the work comes out rough, solved, and bounded (`references/01-shape-up/03-principles-of-shaping.md`).

Draw. Elements first, then breadboards — places, affordances, connection lines (`references/01-shape-up/05-find-the-elements.md`) — and fat marker sketches where an idea is inherently visual. Everything stays lo-fi and hand-drawn on purpose: high-fidelity design done early "will blow up" (`references/03-articles/pitfalls-when-adopting-shape-up.md`), and rough drawings show their readers where their own contributions go.

Then walk the framing's story through the new solution in slow motion: "Given the solution we sketched, how exactly would a user get from the starting point to the end?" (`references/01-shape-up/06-risks-and-rabbit-holes.md`). That walkthrough is the visible fitness test — it either replays the struggling moment with a better ending or it doesn't — and it goes in the document. Name the no-gos as you go: what this project is deliberately not covering.

Technical definitions — schemas, function contracts, spike findings — belong inside the shape, anchored to the element each one defines, never gathered into a technical section of their own.

### The document

One document per project, at `shaping/<project-title>/index.html` in the consuming repo.

It is a feedback instrument before it is anything else. The business rules a build depends on live in the heads of the people who run the business — more of them than any one shaper can hold. So the plan can't be trusted until those people have read it end to end and had their chance to say "that's not how it works here", before the build bakes a wrong rule in. That sets the bar: a non-technical operator reads the whole thing without hitting a wall. The document's own chrome holds the same bar — part-notes, hints, and captions plainly say what each section is, with no clever copy for the reader to decode.

Anatomy, in this order:

1. **Title and essence** — one sentence anyone in the company could repeat.
2. **Status** — built, or not.
3. **The framing**, fully non-technical: the struggling-moment story with verbatim quotes from the demand records, linked to their sources; today's way and where it breaks; the outcome test; why now; the big hire and the little hires by name; a forces drawing if one was reached for.
4. **The shape**: plain language and lo-fi drawings; the walkthrough replaying the framing's story with the new solution in place; the time bombs, each with its solution; the no-gos. Technical definitions live here as in-place toggled affordances on the elements they define.
5. **The goal** — the text that ignites the build.

A toggle hides all technical detail, and both variants print perfectly to PDF. There is no interdependencies section and no revisions section: interdependencies are re-derived every session, git holds the history, and the document states current truth only.

The document never names another project, another repository, or a path that exists only on someone's machine — its prose distills every contract it depends on. When the user points at battle-tested work elsewhere that the build should inherit, the work itself travels: copy the full implementation files, at shaping time, into `shaping/<project-title>/references/`, with a README saying what each file is in its own terms, no word of where it came from. Copy whole, never distill — what the user points at is battle-tested, and improving on it is welcome only when it is deliberate. The one thing that never gets copied is doctrine the consuming repo already owns: its own skills and standing rules are the binding source, and the document points at them rather than forking them.

### The goal

The last section is a thin ignition key, never a second spec. It carries:

- the mission sentence — the document's essence, verbatim;
- as its **first** instruction, read `shaping/<project-title>/index.html` in full as the single source of truth;
- the acceptance criteria: the framing's outcome test, the walkthrough replayed in the shipped product, and — always — a closing audit of the complete implementation against the document, section by section, every element, contract, time bomb defusal, and no-go, with every shortfall fixed before the goal is called met. The audit is part of the goal, never a follow-up;
- only the constraints the goal alone can carry — the base branch, the sequencing of any joined projects, that the no-gos are binding, and the standing instruction that the build session flips the document's built bit when it ships.

Everything else the build needs belongs in the document, where the readers who can correct it will see it. Re-derive the goal whenever the shape changes; that is part of closing a session. It renders behind the technical toggle, in monospace, with a live character count against `/goal`'s 4,000-character limit and a copy button.

### The closing audit

The audit the goal demands runs at the end of the build, not in a shaping session. Two read-only auditors run in parallel, one per half of the document, each in a throwaway worktree of its own, each replaying the walkthrough against the running product rather than reading code alone. The audit covers how the build is made, not only what it shows: the auditors read the implementation of every contract the document binds — the machinery it prescribes, the references it names as inherited, the skills it declares binding — and report a departure as a shortfall even when the walkthrough plays perfectly, because a feature can replay the story while contradicting the document's prescribed mechanics. Both report in one fixed format: the document lines audited, the requirement they state, the observed evidence as `file:line` or live proof, a severity — shortfall, imprecision, or observation — and a proposed disposition. Each charter also carries what is already settled and what is already known, so no auditor spends its window re-deriving a closed question.

The build's orchestrator adjudicates every finding personally, re-verifying the load-bearing ones first-hand, into a register whose lines are citable. The register drives the fix lanes, each fenced to exact files, and a final verifier re-checks every register line against the merged code before the document's built bit flips.

### The final phase

A shape that feels done is not yet done. When the user has read the document end to end and every ruling has settled, two checks close the shaping — our own addition, learned from running the process for real, not from the corpus:

**The audit.** Fan read-only auditors out over the document, one lens each: every claim about the existing system verified against the code it describes; every formula and schema contract checked for internal consistency; every ruling made across the sessions confirmed present and correctly stated; every demand-record quote verified verbatim against its source, link by link; and the document read whole for sections that contradict each other. The shaper adjudicates every finding personally — re-verifying the load-bearing claims first-hand rather than taking an auditor's word — fixes what is real, and declines what is not.

**Builder-comprehension rounds.** A fresh reader on the strongest model available plays the orchestrator of the future build: it reads the document and everything in its folder in full, with read-only access to the codebase for fact-checks, and reports whether it could design the implementation from what it read. Its findings are missing or ambiguous business rules only — implementation design is the build's own job, and a finding that asks for implementation detail is out of bounds. Three weights: a **blocker** it cannot design around, a **guess** it would be forced to make with real stakes on the answer, and a **note** it would carry into the build. Every finding quotes the document's own words, and the charter says plainly that a clean report is a valid report — a reader pressed for findings manufactures them. The shaper adjudicates each finding, improves the document, and launches the next round with a new fresh reader, looping until the shaper is satisfied a further round would come back clean.

The loop ends on the shaper's judgment, the way a code review ends on the owner's: readers propose, the shaper rules.

## Answering questions about the method

When the question is about the method itself — what a breadboard is, how Ryan handles something, what the book actually says — answer from the corpus, not from memory and not from other product frameworks.

1. **Search.** Use Glob and Grep against `references/` to find the documents relevant to the question. Filenames are descriptive, and `references/INDEX.md` maps the whole corpus.
2. **Read.** Open the matching documents in full. For long ones (>250 lines), read by offset — the opening first, then the targeted sections. Some prose exists only inside images — the book embeds whole pitches as screenshots (the To-Do Groups pitch lives in `01-shape-up/images/1.5-to-do_groups_pitch.png`, not in any markdown) — so a quote that greps to nothing may still be real: open the chapter's images before concluding the words aren't in the corpus.
3. **Answer** using only what was just read. Cite the file path so the user can verify.
4. **If the answer doesn't trace to just-opened text, stop and read more.**

Never summarize when the exact words are available — quote them. If several documents apply, read each. If the question spans topics, search again between reads. And where our process departs from the corpus, say so, and say the departure is ours.

## Terminology across eras

The corpus spans years and the vocabulary evolved. Every document's front matter records `published:` — when two sources use different words for the same idea, the dates tell you which usage is current, so check the dates instead of assuming one canonical term. Two threads to know going in: the shaping artifact is a "pitch" in _Shape Up_ (2019), the 2022 post _Framing_ renames the output of shaping a "package", and the newest material uses either word loosely — **our own name for it is the shaping document**. "Rabbit holes" and "time bombs" are two names for the same danger: the book's "Risks and Rabbit Holes" chapter already hunts for "time bombs", and Ryan's newer material uses the names interchangeably. In our own prose and our documents the name is always **time bombs**, never rabbit holes — a rabbit hole sounds like something an engineer wanders into out of perfectionism and could simply decline to enter, while a time bomb is planted in the work itself and goes off no matter how disciplined the builder is.

## Where the references live

- `references/01-shape-up/` — _Shape Up_ by Ryan Singer: shaping, betting, and building, chapter per file.
- `references/02-demand-side-sales-101/` — _Demand-Side Sales 101_ by Bob Moesta with Greg Engle: jobs to be done and the customer's struggle, chapter per file.
- `references/03-articles/` — Ryan Singer's posts, one file per post, spanning 2004 to today: the thinking on shaping, framing, and demand that led to the book, and how it moved afterward.

The corpus is built on each machine by `seasoned-skills corpus` and is never committed: the freely published sources are fetched from their authors' own sites, and the commercial book is vendored only from the user's own compiled copy — when none is given, `02-demand-side-sales-101/` instead carries the workflow's distilled account of the book's method, in our own words.

Every transcript is a single unattributed stream — nothing in them says who is speaking, so never attribute a quoted line to a person. Cite the timestamp instead: it is a position in the video, and the reader can check it there.

## The shaping folder

Shaping documents live in the project they are about, not in this skill. The workflow's install creates `shaping/`, and every sync generates `shaping/assets/` — the stylesheet, the document script, the drawing library — gitignored like every generated file, so a fresh clone renders committed documents after the project's install runs. Start each document by copying the template into a folder named after the project:

```sh
mkdir -p shaping/<project-title>
cp shaping/assets/template.html shaping/<project-title>/index.html
```

`shaping/assets/` holds `template.html`, `document.css`, `document.js`, and the drawing library, shared by every document. A document is the single file `shaping/<project-title>/index.html`, which loads them by relative path.

Standing rulings that bind every session run in a repo — a house doctrine the generic skill stays free of — live in this skill's own project section, woven in from the project's content file. Sessions read it as part of their opening ritual, so anything a repo's teams have settled once holds everywhere without being restated.

The template carries the five parts a shaping document has — the title and the one-sentence essence, the built-or-not status, the framing, the shape, the goal — each with placeholder copy saying what belongs there. It also carries the markup for a technical note anchored beside the thing it defines, and the switch that hides every technical affordance, including the whole goal section, so one file reads both for the people who hold the business rules and for whoever builds it.
