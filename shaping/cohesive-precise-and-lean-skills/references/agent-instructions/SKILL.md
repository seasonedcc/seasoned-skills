---
name: agent-instructions
description: Write and edit the instructions agents read. That covers skills, CLAUDE.md content, and a project's own workflow content. Keep them cohesive, precise, and lean. Use when you write a skill, record a lesson as prose, edit an instruction file, or review a change to one.
---

# Agent instructions

Write every instruction the way a developer shares what they know with a peer. Be plain and warm, in words people say out loud. Never write like a rulebook, and never like a system talking to itself.

This is one of the hardest writing jobs there is. A file at its word budget and its reading ceiling has no free space. Every sentence you add is paid for by one you cut or tighten, and the meaning has to survive both. Bring your best reasoning and your patience. Slow, careful work is the job, not a delay.

## Who reads these files

People and agents read the same file, and they need different things from it. The person reviews every change and has to judge it in one sitting. So the file needs to read like something a colleague wrote. The agent follows the text exactly as written, at the moment it needs it. So every sentence has to mean what it says and nothing more. Prose that works for the person works for the agent. The reverse isn't true: dense text an agent can parse is text people skip over. Over time, instructions no person reads stop matching how we actually work.

## Core principles

1. **Sentence case for all titles.** Write "Reviewing a change", never "Reviewing A Change".

2. **Plain speech, no AI dialect.** Words agents use with each other don't belong in instructions people review. The `seasoned-skills check` command fails a file on each one and names the plain word to write. The list is its `Seasoned.Dialect` rule.

3. **Situation before rule.** Start with the situation, then give the rule. Order a file the same way: say what the thing is and how it works before you say how to change it. A rule that comes before its situation looks arbitrary. An agent applies an arbitrary rule everywhere or nowhere.

4. **Specific over vague.** "Run `pnpm test:unit`" beats "run the tests". Skills, commands, files, and models go by their real names: the worktrees skill, never "the skill for branches". The same goes for phrases you coin. "Every line has to be worth its place" sounds like a rule. It doesn't say what a line has to do to stay. Say that instead: a line stays when it teaches something the reader doesn't already have.

5. **Every rule carries its scope and its reason.** Say when it applies, when it doesn't, and why. The reason is what lets a reader handle a case you never saw coming. Without it, a bare rule gets applied with confidence to the wrong case.

6. **Define terms on first meeting.** The instructions may teach a term of art, such as orchestrator, lane, or gate. They may also name a tool, such as Vale. The first time a reader meets either, a plain-words definition sits right beside it. A tool named before it is described reads as some other tool.

7. **One home per rule.** A rule lives in exactly one place. Everywhere else that needs it points there. Two copies of one rule drift apart the moment one is edited.

8. **No claims nobody can count.** "Every caller", "all N cases", and "always" are promises prose can't keep over a set nobody counted. Write the mechanism and one verified example instead. Keep claims about "all" for sets the text itself defines.

9. **Prefer tooling to prose.** A rule broken twice wants a mechanical guard or sharper wording, never a louder paragraph. When a check can enforce the rule, build the check and delete the paragraph.

10. **Mark the unsettled.** Describe today's way plainly, and say what is still in motion. A reader who takes an unsettled rule as settled is worse off than one who knows it is evolving.

11. **One idea per sentence.** Packing two ideas into one sentence feels like economy, and it costs a second read. Give each idea its own sentence, the long way if the short way needs a re-read. One idea is not one clause: two clauses that belong together stay together. Keep a word out of a spot where it reads two ways: "instructions nobody reviews drift" sends the eye to a noun first.

## AI dialect

Sometimes a dialect word carries a concept the instructions really need. Keep the concept, teach it under a plain name, and define it on first use. Never smuggle the word.

Literal identifiers are the one exception. Command names, configuration keys, and exported symbols are written exactly as they are. Think `seasoned-skills sync` or `disable-model-invocation`. The concepts they carry still get plain names in prose: the sync, the switch that keeps a skill manual.

## Where a rule lives

A lesson has to land somewhere. The wrong home is the usual way a good rule goes bad. It gets restated until the copies disagree, or it goes stale in a file nobody thinks to amend.

- Practice that holds across projects lives in the package. It goes in a skill when it serves one kind of work, and in CLAUDE.md content only when every task in every session needs it before doing anything.
- A project's own facts live in that project's workflow content files. Above all, facts about the project's tooling live there. They go stale the moment the project fixes what they describe, and only the project can fix the text in the same pull request as the fix.
- A lesson travels as an issue, on the project or on the package. How is the self-improvement skill's to teach.

## Skill anatomy

An agent decides whether to load a skill from its description alone. Once it does, it pays for the whole body.

- The description tells an agent when to load the skill: what it does, then "Use when …" with the concrete situations. Write it for the reader deciding whether to load, not for the reader already inside.
- The body carries what every use needs. Detail only some uses need goes to a file under `references/`, loaded on demand. Helper programs go to `scripts/`.

## Size and shape

Every line an agent loads costs tokens on every use. A file a person can't read in one sitting is a file nobody reviews. So the sync measures what it generates and refuses what doesn't fit. It names the file, what broke, and this skill:

- word budgets on every generated skill, its reference files, and the generated CLAUDE.md;
- a name that matches its folder and uses only lowercase letters, digits, and hyphens;
- a generated description within 1,024 characters, project trigger words included;
- em dashes: none in the front matter, at most two in any file;
- a reading grade of six or lower for the whole file, and for the description on its own, which in practice means short sentences;
- Vale, a prose linter, running our rules. It fails the file on a dialect word, jargon, a hedge, shouting, a heading in Title Case, or a sentence past 30 words. It also fails on a misspelling, a dead link, a skill named by anything but its roster name, or a block repeated from another file.

Run `seasoned-skills check` before you commit. It runs the same checks the sync runs, over the generated files, and names what broke. Give it file paths to check a draft the sync doesn't know yet.

Every check fails the file, and there are no warnings to weigh. A rule that could not be made exact was deleted instead. When a sentence reads well and still fails, say so in the pull request. The rule may be the thing to fix.

When a change breaks a budget, make room honestly: cut what fails the change bar, move enforcement to tooling, or move detail only some uses need to a reference file. Never squeeze prose into dialect to fit — the budget counts words, but the point is what each word teaches.

## The change bar

Once you know how these files work, here is what it takes to change one. Every change argues its case in the pull request that carries it, never in the instruction text. The text keeps a rule's scope and its reason, so a reader can apply it. The pull request keeps the case for changing it, so a reviewer can judge it. The bar is the same whichever way the change points.

- An addition names the upside it creates or the live failure it prevents. It shows the rule isn't already on the books in other words. It shows tooling wouldn't do the job better.
- A deletion names why the text is dead. Four reasons count:
  - it made up for a weakness that is gone;
  - it repeats a rule stated elsewhere;
  - tooling now does its job;
  - it teaches nothing that creates upside or prevents a live failure.

A change that can't argue its case isn't made. The same bar covers every edit: a lesson from a finished task, a slimming pass, a brand-new skill.

## Reviewing a change to instructions

- Judge the change by the case it argues, and judge it against the whole file. Read the skill as its reader would, never the diff alone. After a series of fixes, re-read every touched file whole. A set of locally right edits can flatten what the file teaches.
- A contradiction between a concrete recipe and a stated principle is a defect. The recipe is what an agent copies, so the recipe complies or the principle changes, never both left standing.
- One sitting is the bar. When a person can't read the file and judge the change in one sitting, the file is too big or the prose too dense. That is a finding to fix, not a fact of life.

## What the checks can't see

The checks catch what a rule can state exactly. These slip past them, so watch for them yourself:

- Passive voice where an agent acts: "The ledger should be updated" → "Update the ledger"
- Teaching a direction as if it were settled practice
- The case for a change written into the text instead of the pull request
- Restating what the reader already loaded: the rest of CLAUDE.md and the other skills are already in front of them

## Detailed guidance

For the full voice reference with examples, see [references/voice-guide.md](references/voice-guide.md).
