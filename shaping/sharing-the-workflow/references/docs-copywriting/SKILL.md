---
name: docs-copywriting
description: Write human-facing prose for this repository in our voice — the README, every page under docs/, and any other copy a person reads. Use when writing or editing documentation, GitHub-facing text, or prose in release notes meant for human readers. (project)
---

# Docs copywriting

Write every human-facing page as a developer sharing what they know with a peer: plainly, warmly, and in words people say out loud. Never as a company presenting, and never as a system talking to itself.

## Core principles

1. **Sentence case for all titles.** Write "Running a session", never "Running A Session".

2. **Plain speech, no AI dialect.** Words agents use with each other do not survive into human docs. See the translation table below.

3. **Problem before solution.** Show the reader the situation they recognize before naming what solves it.

4. **Specific over vague.** "Under a minute" beats "quickly". "Seven commands" beats "a set of commands".

5. **Define terms on first meeting.** The docs may teach a term of art — orchestrator, shaping, lane — but the first time a reader meets it, a plain-words definition sits right beside it.

6. **Never boast.** The work speaks; the copy never points at it. No claims about our results, no case studies, no benchmarks, no showcase.

7. **Peer tone.** Write like you are explaining to a friend over coffee — a fellow developer, not an audience.

## AI dialect translation table

Words from the workflow's internal dialect that never appear in human docs:

| Dialect | Write instead |
|---------|---------------|
| load-bearing | essential, "that everything depends on" |
| binding | required, "the rule is" |
| doctrine | standing instructions, the rules |
| surface (as a noun) | page, screen, place |
| charter | instructions, the task |
| invoke | run, type, use |
| adjudicate | decide, rule on |
| materialize | create, generate |
| canonical | official, "the one source" |
| affordance | button, link, control |
| artifact | file, document, result |
| downstream / upstream | later / earlier |
| ergonomics | how it feels to use |

When a dialect word carries a concept the docs genuinely need, keep the concept and teach it under a plain name with a first-use definition — never smuggle the word.

## Quick reference

| Element | Pattern | Example |
|---------|---------|---------|
| Headlines | Sentence case, plain topic or problem | "Running a session", "When the context fills up" |
| Rhythm | Short declarative + longer explanation | "It is one command. The package generates everything your agents read, and none of it enters your history." |
| Em dashes | Spaces around them, one or two per page | "The person — not the agent — decides when to compact." |
| Technical terms | Concept first, brief plain definition beside it | "compaction (summarizing the session so far to free space)" |
| Unsettled practice | Described honestly, marked as evolving | "Today we ship through GitHub releases; the staging story is still settling." |

## Anti-patterns (never do these)

- Title Case headlines
- Em dashes without spaces, or more than two on a page
- Corporate jargon: leverage, utilize, seamless, robust, best-in-class, cutting-edge, empower, optimize, synergy, solution
- AI dialect from the table above
- Claims about our results or the quality of what the workflow produces
- Passive voice where a person acts: "The context can be compacted" → "Compact the context"
- Hedging: "should probably", "may want to consider"
- Teaching a direction as if it were settled practice
- Over-explaining what a working developer already knows

## Detailed guidance

For the full voice reference with examples, see [references/voice-guide.md](references/voice-guide.md).
