---
name: agent-instructions
description: Write and edit the instructions agents read, from skills and CLAUDE.md content to a project's own workflow content, so they stay plain, scoped, and worth their place. Use when writing a skill, recording a lesson as prose, editing instruction files, or reviewing a change to any of them.
---

# Agent instructions

Write every instruction as a developer sharing what they know with a peer: plainly, warmly, and in words people say out loud. Never as a rulebook, and never as a system talking to itself.

## Who reads these files

Two readers, and they want different things from the same text. A person reviews every change and has to judge it in one sitting, so the file needs to read like something a colleague wrote. An agent follows the text exactly as written, at the moment it needs it, so every sentence has to mean what it says and nothing more. Prose that works for the person works for the agent. The reverse isn't true: dense text an agent can parse is text nobody reviews, and instructions nobody reviews drift.

## Core principles

1. **Sentence case for all titles.** Write "Reviewing a change", never "Reviewing A Change".

2. **Plain speech, no AI dialect.** Words agents use with each other do not survive into instructions people review. See the translation table below.

3. **Situation before rule.** Show the reader the moment the rule is for, then state the rule, and order a file the same way: what the thing is and how it works comes before how to change it. A rule that arrives before its situation reads as arbitrary, and an agent applies an arbitrary rule everywhere or nowhere.

4. **Specific over vague.** "Run `pnpm test:unit`" beats "run the tests", and skills, commands, files, and models go by their real names: the kysely skill, never "the database skill".

5. **Every rule carries its scope and its reason.** Say when it applies, when it doesn't, and why. The reason is what lets a reader handle the case you never anticipated. Without it, an unqualified rule gets applied confidently to the wrong situation.

6. **Define terms on first meeting.** The instructions may teach a term of art, such as orchestrator, lane, or gate, but the first time a reader meets it, a plain-words definition sits right beside it.

7. **One home per rule.** A rule lives in exactly one place, and everywhere else that needs it points there. Two statements of one rule drift apart the moment one is edited.

8. **No claims nobody can count.** "Every caller", "all N cases", and "always" are promises prose can't keep over a set nobody counted. Write the mechanism and a verified example instead, and keep totality claims for sets the text itself defines.

9. **Prefer tooling to prose.** A rule broken twice wants a mechanical guard or sharper phrasing, never a louder paragraph. When a check can enforce the rule, build the check and delete the paragraph.

10. **Mark the unsettled.** Describe today's way plainly and say what is still in motion. A reader who adopts an unsettled rule as settled is worse off than one who knows it is evolving.

## AI dialect translation table

Words from the workflow's internal dialect that never appear in the instructions:

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
| corpus | the reference library (the books and posts the method draws on) |

When a dialect word carries a concept the instructions genuinely need, keep the concept and teach it under a plain name with a first-use definition — never smuggle the word.

Literal identifiers are the one exception: command names, configuration keys, and exported symbols are written exactly as they are, `seasoned-skills sync` and `disable-model-invocation` included, and the concepts they carry get plain names in prose (the sync, the switch that keeps a skill manual).

## Where a rule lives

A lesson has to land somewhere, and the wrong home is the usual way a good rule goes bad: it gets restated until the copies disagree, or it goes stale in a file nobody thinks to amend.

- Practice that holds across projects lives in the package: in a skill when it serves one kind of work, in CLAUDE.md content only when every task in every session needs it before doing anything.
- A project's own facts live in that project's workflow content files. Above all, empirical detail about the project's tooling lives there: it goes stale the moment the project fixes what the detail describes, and only the project can amend it in the same pull request as the fix.
- How a lesson travels, as an issue on the project or on the package, is the self-improvement skill's to teach.

## Skill anatomy

An agent decides whether to load a skill from its description alone, and pays for the whole body once it does.

- The description tells an agent when to load the skill: what it does, then "Use when …" with the concrete situations. Write it for the reader deciding whether to load, not for the reader already inside.
- The body carries what every use needs. Detail only some uses need goes to a file under `references/`, loaded on demand; executable helpers go to `scripts/`.

## Size and shape

Every line an agent loads costs tokens on every use, and a file a person can't read in one sitting is a file nobody reviews. So the sync measures what it generates and refuses what doesn't fit, naming the file, what broke, and this skill:

- word budgets on every generated skill, its reference files, and the generated CLAUDE.md;
- a name that matches its folder and uses only lowercase letters, digits, and hyphens;
- a generated description, project trigger words included, within 1,024 characters;
- em dashes: none in the front matter, at most two in any file.

When a change breaches a budget, make room honestly: cut what fails the change bar, move enforcement to tooling, or move on-demand detail to a reference file. Never compress prose into dialect to fit — the budget measures words, but the bar is worth per word.

## The change bar

Once you know how these files work, here is what it takes to change one. Every change argues its case in the pull request that carries it, never in the instruction text. The text keeps a rule's scope and its reason, so a reader can apply it; the pull request keeps the case for changing it, so a reviewer can judge it. The bar is the same whichever direction the change points.

- An addition names the upside it creates or the live failure it prevents, shows the rule is not already on the books in other words, and shows the job would not be done better by tooling.
- A deletion names why the text is dead: it compensated for a weakness that is gone, it duplicates a rule stated elsewhere, tooling now does its job, or it teaches nothing that creates upside or prevents a live failure.

A change that cannot argue its case is not made. The same bar covers every edit: a lesson from a finished task, a slimming pass, a brand-new skill.

## Reviewing a change to instructions

- Judge the change by the case it argues, and judge it against the whole file: read the skill as its reader would, never the diff alone. After a series of fixes, re-read every touched file whole, because a set of locally right edits can flatten what the file teaches.
- A contradiction between a concrete recipe and a stated principle is a defect. The recipe is what an agent copies, so the recipe complies or the principle changes, never both left standing.
- One sitting is the bar. When a person can't read the file and judge the change in one sitting, the file is too big or the prose too dense, and that is a finding to fix, not a fact of life.

## Anti-patterns (never do these)

- Title Case headlines
- Em dashes without spaces, more than two in a file, or any in the front matter
- Corporate jargon: leverage, utilize, seamless, robust, best-in-class, cutting-edge, empower, optimize, synergy, solution
- AI dialect from the table above
- Shouting: capitals, bold, and "critical" where a scoped rule would do
- Passive voice where an agent acts: "The ledger should be updated" → "Update the ledger"
- Hedging: "should probably", "may want to consider"
- Teaching a direction as if it were settled practice
- The case for a change written into the text instead of the pull request
- Restating what the reader already loaded: the rest of CLAUDE.md and the other skills are already in front of them

## Detailed guidance

For the full voice reference with examples, see [references/voice-guide.md](references/voice-guide.md).
