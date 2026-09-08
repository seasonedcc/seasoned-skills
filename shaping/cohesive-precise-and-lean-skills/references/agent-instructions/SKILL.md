---
name: agent-instructions
description: Write and edit the instructions agents read. That covers skills, CLAUDE.md content, and a project's own workflow content. Keep them cohesive, precise, and lean. Use when you write a skill, record a lesson as prose, edit an instruction file, or review a change to one.
---

# Agent instructions

Write every instruction the way a developer shares what they know with a peer. Be plain and warm, in words people say out loud. Never write like a rulebook, and never like a system talking to itself.

This is one of the hardest writing jobs there is. A file at its word budget and its reading ceiling has no free space. Every sentence you add is paid for by one you cut or tighten, and the meaning has to survive both. Bring your best reasoning and your patience. Slow, careful work is the job, not a delay.

## Who reads these files

People and agents read the same file, and they need different things from it. The person reviews every change and has to judge it in one sitting. So the file needs to read like something a colleague wrote. The agent follows the text exactly as written, at the moment it needs it. So every sentence has to mean what it says and nothing more. Prose that works for the person works for the agent. The reverse isn't true: dense text an agent can parse is text people skip over. Over time, instructions no person reads stop matching how we actually work.

## How these files are made

The `seasoned-skills` package carries the skills and the CLAUDE.md content every project shares. A project adds its own facts in workflow content files. The `seasoned-skills sync` command weaves both into the files agents load: one generated skill per skill folder, and one generated CLAUDE.md. Nobody edits a generated file. The sync also checks what it generates, under the limits in Size and shape below. The `seasoned-skills check` command runs the same checks. It takes the generated files, or any file paths you give it, and names what broke. Part of it is Vale, a prose linter that runs our word rules.

## Core principles

1. **Sentence case for all headings.** Write "Reviewing a change", never "Reviewing A Change". In Title Case, a reader can't tell a name from a word.

2. **Plain speech, no AI dialect.** Words agents use with each other don't belong in instructions people review. The `Seasoned.Dialect` rule in Vale carries the list and names the plain word for each.

3. **Situation before rule.** Start with the situation, then give the rule. Order a file the same way: say what the thing is and how it works before you say how to change it. A rule that comes before its situation looks arbitrary. An agent applies an arbitrary rule everywhere or nowhere.

4. **Specific over vague.** "Run `pnpm test:unit`" beats "run the tests". Skills, commands, files, and models go by their real names: the worktrees skill, never "the skill for branches". A real name is what a reader can search for and load. The same goes for phrases you coin. "Every line has to be worth its place" sounds like a rule. It doesn't say what a line has to do to stay. Say that instead. For lines, the change bar below is the test.

5. **Every rule carries its scope and its reason.** Say when it applies, when it doesn't, and why. The reason is what lets a reader handle a case you never saw coming. Without it, a bare rule gets applied with confidence to the wrong case.

6. **Define terms on first meeting.** The instructions may teach a term of art, such as orchestrator, lane, or gate. They may also name a tool, such as Vale. The first time a reader meets either, a plain-words definition sits right beside it. A tool named before it is described reads as some other tool.

7. **One home per rule.** A rule lives in exactly one place. Everywhere else that needs it points there. That includes what the reader already has loaded: CLAUDE.md is always in front of them. Two copies of one rule drift apart the moment one is edited.

8. **No claims nobody can count.** "Every caller", "all N cases", and "always" are promises prose can't keep over a set nobody counted. Write the mechanism and one verified example instead. Keep claims about "all" for sets the text itself defines.

9. **Prefer tooling to prose.** A rule broken twice wants a mechanical guard or sharper wording, never a louder paragraph. Once may be chance. Twice shows the prose isn't holding, and a louder paragraph is more prose. When a check can enforce the rule, build the check and delete the paragraph.

10. **Mark the unsettled.** Describe today's way plainly, and say what is still in motion. A reader who takes an unsettled rule as settled is worse off than one who knows it is evolving.

11. **One idea per sentence.** Packing two ideas into one sentence feels like economy, and it costs a second read. Give each idea its own sentence. A longer sentence that reads once beats a short one that needs a re-read. One idea is not one clause: two clauses that belong together stay together.

12. **No word where it reads two ways.** "Instructions nobody reviews drift" sends the eye to a noun first, so the reader has to back up to find the verb. Write "Instructions drift when nobody reviews them."

13. **Active voice where an agent acts.** "The ledger should be updated" hides who acts. Write "Update the ledger."

## AI dialect

Sometimes a dialect word carries a concept the instructions really need. Keep the concept, teach it under a plain name, and define it on first use. Never smuggle the word.

Literal identifiers are the one exception. Command names, configuration keys, and exported symbols are written exactly as they are. Think `seasoned-skills sync` or `disable-model-invocation`. The concepts they carry still get plain names in prose: the sync, the switch that keeps a skill manual.

## Where a rule lives

A lesson has to land somewhere. A rule in the wrong home goes bad two ways. It gets restated until the copies disagree, or it goes stale in a file nobody thinks to amend.

- Practice that holds across projects lives in the package. It goes in a skill when it serves one kind of work. It goes in CLAUDE.md content only when every task in every session needs it before doing anything.
- A project's own facts live in that project's workflow content files. That includes workarounds for its tooling. A workaround goes stale the moment the project fixes what it worked around. Only the project can fix the text in the same pull request as the fix.
- A lesson travels as an issue, on the project or on the package. The self-improvement skill teaches how.

## Skill anatomy

An agent decides whether to load a skill from its description alone. Once it does, it pays for the whole body.

- The description tells an agent when to load the skill: what it does, then "Use when …" with the concrete situations. Write it for the reader deciding whether to load, not for the reader already inside.
- The body carries what every use needs. Detail only some uses need goes to a file under `references/`, loaded on demand. Helper programs go to `scripts/`.

## Size and shape

Every line an agent loads costs tokens on every use, and a file past the one-sitting bar goes without review. So the sync refuses what doesn't fit, naming the file, what broke, and this skill. The limits:

- word budgets: today about 2,000 words for a skill or one of its reference files, and 2,500 for the generated CLAUDE.md. The check states the exact number;
- a name that matches its folder and uses only lowercase letters, digits, and hyphens;
- a generated description within 1,024 characters, counting the trigger words a project adds;
- em dashes: none in the front matter, at most two in any file;
- a reading grade of six or lower for the whole file, and for the description on its own, which in practice means short sentences;
- the prose rules:
  - no dialect word, jargon, hedge, or shouting;
  - no heading in Title Case;
  - no sentence past 30 words;
  - no misspelling, dead link, or block repeated from another file;
  - no skill named by anything but its folder name.

Run `seasoned-skills check` before you commit. Give it file paths to check a draft the sync doesn't know yet.

Every check fails the file, and there are no warnings to weigh. When a sentence reads well and still fails, change it so the check passes, and say in the pull request that the rule may be the thing to fix.

## The change bar

Once you know how these files work, here is what it takes to change one. Every change argues its case in the pull request that carries it, never in the instruction text. The text keeps a rule's scope and its reason, so a reader can apply it. The pull request keeps the case for changing it, so a reviewer can judge it. One form of the case in the text is a trace of what was removed, like "the list lives elsewhere, never here". Nobody reading the finished file saw the old version.

- An addition names the upside it creates or the failure it prevents. A failure counts when it has happened, not when it is imagined. It shows no existing rule already says the same thing in other wording. It shows tooling wouldn't do the job better.
- A deletion names why the text is dead. Four reasons count:
  - it made up for a weakness that is gone;
  - it repeats a rule stated elsewhere;
  - tooling now does its job;
  - it teaches nothing that creates upside or prevents a failure that has happened.

Don't make a change that can't argue its case. The same bar covers every edit, addition or deletion: a lesson from a finished task, a slimming pass, a brand-new skill.

When a change breaks a budget, make room honestly. Cut what fails the bar, move enforcement to tooling, or move detail only some uses need to a reference file. Never squeeze prose into dialect to fit — the budget counts words, but the point is what each word teaches.

## Reviewing a change to instructions

- Judge the change by the case it argues, and judge it against the whole file. Read the skill as its reader would, never the diff alone. After a series of fixes, re-read every touched file whole. A set of locally right edits can flatten what the file teaches.
- The author never judges their own round of edits: they read the file as they meant it, not as it is. A fresh agent with this skill loaded reads every touched file whole. It reports each sentence that breaks a principle and names the principle. The author judges each finding, never at face value, and fixes or declines it in the pull request. Then a new fresh agent reads again. The cycle ends when the author is satisfied with the file, not when a reader runs out of findings.
- A contradiction between a concrete recipe and a stated principle is a defect. The recipe is what an agent copies, so the recipe complies or the principle changes, never both left standing.
- A file that fails the one-sitting bar is too big or too dense. That is a finding to fix, not a fact of life.

## Detailed guidance

When a sentence passes every check and still reads like a system talking, see [references/voice-guide.md](references/voice-guide.md). It shows the voice with examples.
