---
name: agent-instructions
description: Write and edit the instructions agents read — skills, CLAUDE.md content, and a project's own workflow content — so they stay plain, scoped, and worth their place. Use when writing a skill, recording a lesson as prose, editing instruction files, or reviewing a change to any of them.
---

# Agent instructions

Write every instruction as one senior practitioner briefing another: plainly, directly, in words a person would say out loud. A person reviews every change to these files and must be able to judge it in one sitting, and an agent follows what it reads exactly as written — so every sentence earns its keep, and every word means what it says.

## The change bar

Every change to the instructions argues its case in the change itself, whichever direction it points.

- An addition names the upside it creates or the live failure it prevents, shows the rule is not already on the books in other words, and shows the job would not be done better by tooling.
- A deletion names why the text is dead: it compensated for a weakness that is gone, it duplicates a rule stated elsewhere, tooling now does its job, or it teaches nothing that creates upside or prevents a live failure.

A change that cannot argue its case is not made. The same bar covers every edit — a lesson from a finished task, a slimming pass, a brand-new skill.

## Writing principles

1. **Plain speech, no AI dialect.** Words agents use with each other do not survive into instructions people review. See the translation table below.

2. **Specific over vague — name the instruments.** "Run `pnpm test:unit`" beats "run the tests", and skills, commands, files, and models go by their real names: the kysely skill, never "the database skill". A rule about nothing in particular teaches nothing in particular.

3. **Every rule carries its scope and its reason.** An unqualified rule misfires confidently: say when the rule applies, when it does not, and why. The reason is what lets a reader apply the rule to a case it never anticipated.

4. **One home per rule.** A rule lives in exactly one place; everywhere else that needs it points there. Two statements of one rule drift apart the moment one is edited.

5. **Define terms on first meeting.** The instructions may teach a term of art — orchestrator, lane, gate — but the first time a reader meets it, a plain-words definition sits right beside it.

6. **No claims nothing can recount.** "Every caller", "all N cases", "always" are promises prose cannot keep over a set no check can count. Write the mechanism and a verified example instead, and save totality claims for sets the text itself defines.

7. **Prefer tooling to prose.** A rule violated twice wants a mechanical guard or sharper phrasing, never a louder paragraph. When a check can enforce the rule, build the check and delete the paragraph.

8. **Mark the unsettled.** Describe today's way plainly and say what is still in motion. A reader who adopts an unsettled rule as settled is worse off than one who knows it is evolving.

## AI dialect translation table

Words from the agents' own register that never appear in the instructions:

| Dialect | Write instead |
|---------|---------------|
| doctrine | the standing rules |
| load-bearing | essential, "that everything depends on" |
| binding | required, "the rule is" |
| adjudicate | decide, rule on |
| charter | the task instructions |
| surface (as a noun) | page, screen, place |
| canonical | official, "the one source" |
| artifact | file, document, result |
| materialize | create, generate |
| affordance | button, link, control |
| downstream / upstream | later / earlier |
| ergonomics | how it feels to use |

When a dialect word carries a concept the instructions genuinely need, keep the concept and teach it under a plain name with a first-use definition — never smuggle the word. Literal identifiers are the one exception: command names, configuration keys, and exported symbols are written exactly as they are.

## Where a rule lives

- Practice that holds across projects lives in the package: in a skill when it serves one kind of work, in CLAUDE.md content only when every task in every session needs it before doing anything.
- A project's own facts live in that project's workflow content files — above all empirical detail about the project's tooling, which goes stale the moment the project fixes what the detail describes, and which only the project can amend in the same pull request as the fix.
- How a lesson travels — as an issue on the project or on the package — is the self-improvement skill's to teach.

## Skill anatomy

- The description tells an agent when to load the skill: what it does, then "Use when …" with the concrete situations. Write it for the reader deciding whether to load, not for the reader already inside.
- The skill body carries what every use needs. Detail only some uses need goes to a file under `references/`, loaded on demand; executable helpers go to `scripts/`.
- Headings use sentence case: "Reviewing a change", never "Reviewing A Change".

## Size

Budgets cover the generated files agents actually load — the sync refuses a file over budget and names the file, the excess, and this skill. When a change breaches a budget, make room honestly: cut what fails the change bar, move enforcement to tooling, or move on-demand detail to a reference file. Never compress prose into dialect to fit — the budget measures words, but the bar is worth per word.

## Reviewing a change to instructions

- Judge the change by the case it argues, and judge it against the whole file: read the skill as its reader would, never the diff alone. After a series of fixes, re-read every touched file whole — a set of locally right edits can flatten what the file teaches.
- A contradiction between a concrete recipe and a stated principle is a defect. The recipe is what an agent copies, so the recipe complies or the principle changes — never both left standing.
- One sitting is the bar. When a person cannot read the file and judge the change in one sitting, the file is too big or the prose too dense, and that is a finding to fix, not a fact of life.

## Detailed guidance

For the full voice reference with examples, see [references/voice-guide.md](references/voice-guide.md).
