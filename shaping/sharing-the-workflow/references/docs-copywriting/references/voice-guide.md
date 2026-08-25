# Documentation voice guide

Comprehensive reference for this repository's human-facing prose: the README, everything under `docs/`, and any other text a person reads.

## The voice

The voice is **a developer who has lived this way of working, sharing it with a peer**. Not a faceless project, not a marketer, not a system describing itself. Someone who has been in the trenches and found something worth writing down.

### Personality traits

| Trait | How it shows up |
|-------|-----------------|
| **Conversational** | Contractions, casual transitions, sentences you could say out loud |
| **Empathetic** | Acknowledging real frustrations before presenting what helps |
| **Confident** | Direct statements without hedging |
| **Specific** | Concrete details over vague claims ("seven commands", not "a rich CLI") |
| **Personal** | First person for lived experience, second person for the reader |
| **Honest** | Saying plainly what is settled, what is evolving, and what it costs |

### What we sound like

> "We were tired of teaching every lesson twice."

> "You shape the work. Agents build it."

> "Install it once; every improvement reaches every project on its next upgrade."

> "This way of working is token-intensive. Plan on more than one subscription, and learn your own number."

### What we don't sound like

> "This framework leverages cutting-edge agentic capabilities to deliver best-in-class outcomes."

> "The doctrine layer deterministically materializes load-bearing surfaces."

> "Our robust orchestration platform enables seamless integration across the development lifecycle."

## Sentence structure patterns

### Short + long rhythm

Alternate punchy declarations with explanatory sentences:

> "It is one command. The package generates everything your agents read, and none of it enters your history."

> "Shaping takes longer than building now. That inversion changes how work gets planned, and the docs say so plainly."

### Em-dash asides

Use em dashes to insert a conversational break or a contrast.

**Always put spaces around em dashes.**

- Correct: "The person — not the agent — decides when to compact."
- Wrong: "The person—not the agent—decides when to compact."

**Ration them.** One or two per page, at the moments that deserve emphasis. More than that and the voice reads affected instead of natural.

### Rhetorical questions

Pose a problem the reader recognizes — sparingly, and only when the reader would genuinely ask it:

> "Ever watched an agent confidently repeat a mistake you fixed last month?"

### Fragments for emphasis

Break a grammatical rule occasionally, for impact:

> "No forks. No copies. Configuration."

> "One package. Every project. The same lessons."

## Perspective and pronouns

### First person for lived experience

Use "we" for the people behind the workflow and the choices they made:

> "We built this because we were maintaining the same instructions in three repositories, by hand."

> "We learned this the hard way: an agent will happily work past the point where its output degrades."

### Second person for the reader

Use "you / your" to put the reader in the driver's seat:

> "Your project keeps two files: the configuration and your own content."

> "You watch three things during a build, and you are away from the keyboard for most of it."

### Ownership language

The reader's project stays theirs:

> "your project", "your agents", "your own content"

## Headlines and titles

### Always sentence case

Never Title Case. This applies to every heading, page title, and link text.

**Correct:**

- "Running a session"
- "How work enters the system"
- "What a project receives"

**Wrong:**

- "Running A Session"
- "How Work Enters The System"

### Headline patterns

| Pattern | Example |
|---------|---------|
| Plain topic | "Running a session" |
| Problem statement | "When the context fills up" |
| How-to | "How work enters the system" |
| Contrast | "Bigger batches, not tasks" |

## Word choice

### Use / avoid

| Avoid | Use instead |
|-------|-------------|
| leverage | use |
| utilize | use |
| solution | tool, approach, answer |
| robust | solid, reliable |
| seamless | smooth, easy |
| cutting-edge | modern, new |
| best-in-class | — (just describe it) |
| empowers | lets |
| synergy | — (avoid entirely) |
| optimize | improve |
| paradigm | approach, way |

### AI dialect

The full translation table lives in [../SKILL.md](../SKILL.md). The principle: if you would not say the word to a colleague across the table, it does not belong on the page. When the concept behind a dialect word is real and the docs need it, teach the concept under a plain name and define it on first meeting.

### Technical terms

Don't over-explain, but don't assume the reader has lived this workflow:

**Good:** "The context window — everything the agent is working from at a given moment — fills as the session runs."

**Good:** "compaction (summarizing the session so far to free space)"

**Bad:** "The orchestrator's context accretes tool-result tokens until compaction pressure necessitates ledger consolidation."

Terms of art the docs teach — orchestrator, shaping, lane, gates — get their plain-words definition the first time they appear, and are used consistently afterwards. Never define the same term two different ways on two pages.

## Honesty about the unsettled

Some of our practice is still in motion. Describe today's way plainly, and mark the frontier as a frontier:

> "Today we ship through GitHub releases; the staging story is still settling."

Never teach a direction as if it were settled practice, and never hide that something is evolving — a reader who adopts an unsettled rule as gospel is worse off than one who knows it is in motion.

## Never boast

The docs never say the output is good. They show how the work is done and let the reader draw the conclusion.

**Wrong:** "This workflow produces exceptionally clean codebases."

**Wrong:** "Teams using this approach ship dramatically faster."

**Right:** "Every change lands through a reviewed pull request with the full test suite green."

**Right:** "A lesson learned once is written once, and reaches every project on its next upgrade."

The same rule shapes structure, not just sentences: no case-study pages, no benchmark tables, no showcase or "who uses this" sections.

## Tone by context

| Context | Tone | Example |
|---------|------|---------|
| README front door | Plain, confident, inviting | "Seasoned's skills to orchestrate the full product cycle with AI agents" |
| Teaching pages | Narrative, reflective, honest | "We were tired of teaching every lesson twice." |
| The session manual | Direct, procedural, calm | "Before the context bar turns yellow, start looking for a moment to compact." |
| Reference pages | Precise, unadorned, fast | "`--force` re-downloads sources already in the reference library." |
| Release notes (human-facing prose) | Factual, brief | "The sweep command now kills only by exact process id." |

## Checklist before merging

- [ ] All titles and headings use sentence case
- [ ] No AI dialect (check the translation table)
- [ ] No corporate jargon
- [ ] Every term of art defined on first meeting
- [ ] No claims about our results
- [ ] Em dashes spaced, at most one or two per page
- [ ] Specific numbers wherever they exist
- [ ] Unsettled practice marked as evolving
- [ ] Reads like a peer wrote it
