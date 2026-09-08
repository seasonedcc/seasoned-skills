---
name: agent-instructions
description: Write and edit the instructions agents read. That covers skills, CLAUDE.md content, and a project's own workflow content. Keep them cohesive, precise, and lean. Use when you write a skill, record a lesson as prose, edit an instruction file, or review a change to one.
---

# Agent instructions

Write every instruction the way a developer shares what they know with a peer. Be plain and warm, in words people say out loud. Never write like a rulebook, and never like a system talking to itself.

This is one of the hardest writing jobs there is. A file at its word budget and its reading ceiling has no free space. Every sentence you add is paid for by one you cut or tighten, and the meaning has to survive both. Bring your best reasoning and your patience. Slow, careful work is the job, not a delay.

## Who reads these files

People and agents read the same file, and they need different things from it. The person reviews every change and has to judge it in one sitting. So the file needs to read like something a colleague wrote. The agent follows the text exactly as written, at the moment it needs it. So every sentence has to mean what it says and nothing more. Prose that works for the person works for the agent. The reverse isn't true: dense text an agent can parse is text people skip over. Over time, instructions that no person reads stop matching how we actually work.

## Skill anatomy

A skill is a folder holding a `SKILL.md`, named after the skill. The package keeps its skills under `content/skills/`; a project commits its own under `.claude/skills/`. The file opens with front matter, the block between `---` lines, holding the skill's name and description. Everything below is the body. An agent decides whether to load a skill from its description alone. Once it loads one, the whole body loads.

- The description tells an agent when to load the skill: what it does, then "Use when …" with the concrete situations. Write it for the reader deciding whether to load, not for the reader already inside.
- The body carries what every use needs. Detail that only some uses need goes to a file under `references/`, loaded on demand. Helper programs go to `scripts/`, where no prose check reads them.

## How these files are made

The `seasoned-skills` package carries the skills and the CLAUDE.md content every project shares. A project adds its own facts in its workflow content files. Those are one for CLAUDE.md, plus one per skill it extends, named after the skill. Their folder is the `contentDir` key in `seasoned-skills.config.ts`. The `seasoned-skills sync` command weaves both into the files agents load. That is one generated CLAUDE.md, and one generated skill per skill. A `triggers:` line in a project file's front matter adds words to the description the sync generates for that skill. Never edit a generated file; the next sync overwrites it. The sync checks what it generates under the limits in Size and shape below. The `seasoned-skills check` command runs the same checks, over the generated files or any file paths you give it. The check runs Vale, a prose linter, for the word rules.

## Core principles

1. **Sentence case for all headings.** Write "Reviewing a change", never "Reviewing A Change". In Title Case, a reader can't tell a name from a word.

2. **Plain speech, no AI dialect.** Words that agents use with each other don't belong in instructions people review. The `Seasoned.Dialect` rule in Vale carries the list and names the plain word for each. The check prints both when it flags a word. Sometimes a dialect word carries a concept the instructions really need. Keep the concept under a plain name and let the word go. Literal identifiers are the one exception. A reader has to type or search for them as they are. Write `seasoned-skills sync` exactly so, and give the concept a plain name in prose: the sync.

3. **Situation before rule.** Give the situation first, then the rule. Order a file the same way: say what the thing is and how it works before you say how to change it. A rule that comes before its situation looks arbitrary. An agent applies an arbitrary rule everywhere or nowhere.

4. **Specific over vague.** "Run `pnpm test:unit`" beats "run the tests". Skills, commands, files, and models go by their real names: the worktrees skill, never "the skill for branches". A real name is what a reader can search for and load. The same goes for phrases you coin. "Every line has to be worth its place" sounds like a rule but names no test. Say what the line has to do.

5. **Every rule carries its scope and its reason.** Say when it applies, when it doesn't, and why. The reason is what lets a reader handle a case you never saw coming.

6. **Define terms on first meeting.** The instructions may teach a term of art, such as orchestrator or lane, or name a tool, such as Vale. The first time a reader meets either, a plain-words definition sits right beside it. If you name a tool before you describe it, the reader guesses which tool.

7. **One home per rule.** A rule lives in exactly one place. Everywhere else that needs it points there. Every session loads CLAUDE.md, so a skill points there too, never copies. Two copies of one rule drift apart the moment one is edited.

8. **No claims nobody can count.** "Every caller", "all N cases", and "always" are promises prose can't keep over a set nobody counted. Say what guarantees it, and give one example you checked yourself. Keep claims about "all" for sets the text itself defines.

9. **Prefer tooling to prose.** A rule broken twice wants a mechanical guard, or wording that names the case it was broken in. Never a louder paragraph. Once may be chance. Twice shows the prose isn't holding, and a louder paragraph is more of the same. When a check can enforce the rule, build it and keep only the reason in prose. The checks live in the package, so building one is a pull request there.

10. **Mark the unsettled.** Describe today's way plainly, with "today" in front of it, and say what may change. A reader who takes an unsettled rule as settled is worse off than one who knows it is evolving.

11. **One idea per sentence.** Two ideas in one sentence cost a second read. Give each idea its own sentence. One idea is not one clause: two clauses that belong together stay together. A longer sentence that reads once beats a short one that needs a re-read.

12. **No sentence that reads wrong first.** "Instructions nobody reviews drift" sends the eye to a noun first. Write "Instructions drift when nobody reviews them."

13. **Active voice where an agent acts.** "The tests should be run" hides who acts. Write "Run the tests."

## Where a rule lives

A rule in the wrong home goes bad two ways. Authors restate it until the copies disagree. Or it goes stale in a file nobody thinks to amend.

- Practice that holds across projects lives in the package. It goes in a skill when it serves one kind of work. It goes in CLAUDE.md content only when every task in every session needs it before doing anything.
- A project's own facts live in that project's workflow content files. That includes workarounds for its tooling. A workaround goes stale the moment the project fixes what it worked around. Delete the workaround text in the same pull request that fixes the tooling.
- A lesson from a task never lands in either home directly. The task that found it is not the place to argue its case. It travels as an issue, on the project or on the package. The change to the text comes later, in a pull request of its own. The self-improvement skill teaches how.

## Size and shape

Every line an agent loads costs tokens on every use. A file too long for one sitting goes without review. So the sync refuses what doesn't fit, naming the file, what broke, and this skill. The limits:

- word budgets: 2,000 words for a skill body or a reference file, and 2,500 for the generated CLAUDE.md;
- a `name` that matches the skill's folder and uses only lowercase letters, digits, and hyphens;
- a generated description within 1,024 characters, the project's `triggers:` words included;
- em dashes: none in the front matter, and at most two in any file, since past two the voice reads affected;
- a reading grade of six or lower, as the check computes it, for the whole file and for the description on its own;
- the prose rules:
  - no dialect word, jargon, hedge such as "may want to consider", or shouting in capitals;
  - no heading in Title Case;
  - no sentence past 30 words;
  - no misspelling, dead link, or paragraph repeated from another file;
  - no skill named by anything but its folder name.

Run `seasoned-skills check` before you commit, so the failure reaches you and not the reviewer.

When a sentence reads well and still fails, change it so the check passes. Then say in the pull request that the rule may be the thing to fix.

## The change bar

Every change argues its case in the pull request that carries it, never in the instruction text. The text keeps a rule's scope and its reason, so a reader can apply it. The pull request keeps the case for changing it, so a reviewer can judge it. A sentence like "the list lives elsewhere, never here" is the case leaking in. Readers after the merge never had the old version, so it explains nothing to them.

- An addition names the upside it creates or the failure it prevents. A failure counts when it has happened, not when it is imagined. The author shows that no existing rule says the same thing in other wording. The author also shows that tooling wouldn't do the job better.
- A deletion names why the text is dead. Four reasons count:
  - it made up for a weakness of the model or the tooling that is gone;
  - it repeats a rule stated elsewhere;
  - tooling now does its job;
  - it teaches nothing that creates upside or prevents a failure that has happened.

When a change breaks a budget, make room honestly. Cut what fails the bar, move enforcement to tooling, or move detail to a reference file when only some uses need it.

## Reviewing a change to instructions

- Whoever reviews, the person or an agent, judges the change by the case it argues. They judge it against the whole file, read as its reader would, never as a diff. After a series of fixes, they re-read every touched file whole. A set of locally right edits can flatten what the file teaches.
- The author never reviews their own round of edits: they read the file as they meant it, not as it is. A fresh agent reviews as above, with the pull request and every touched file. Fresh means this skill loaded and no memory of the edits. It reports each sentence that breaks a rule in this file, naming the rule. The author answers each finding in the pull request, fixing or declining it. The author takes none at face value: a fresh reader knows the rules, not the history behind a sentence. Then a new fresh agent reads again. The cycle ends when the author is satisfied with the file, not when a reader runs out of findings. An empty round proves only that one reader found nothing.
- A concrete step, like a command to run, can contradict a stated principle. That is a defect. The step is what an agent copies. So change the step to comply, or change the principle to match. Leaving both standing keeps the defect.
- When the person reviewing couldn't read the file and judge the change in one sitting, the file is too big or too dense. That is a finding to fix, not a fact of life.

## Voice guide

When a sentence passes every check and still reads like a system talking, see [references/voice-guide.md](references/voice-guide.md).
