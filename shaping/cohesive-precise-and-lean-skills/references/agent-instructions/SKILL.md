---
name: agent-instructions
description: Write and edit the instructions agents read. That covers skills, CLAUDE.md content, and a project's own workflow content. Keep them cohesive, precise, and lean. Use when you write a skill, record a lesson as prose, edit an instruction file, or review a change to one.
---

# Agent instructions

Write every instruction the way a developer shares what they know with a peer. Be plain and warm, in words people say out loud. Never write like a rulebook, and never like a system talking to itself.

This is one of the hardest writing jobs there is. A file at its word budget and its reading ceiling has no free space. Every sentence you add is paid for by one you cut or tighten, and the meaning has to survive both. Bring your best reasoning and your patience. Slow, careful work is the job, not a delay.

## Who reads these files

People and agents read the same file, and they need different things from it. The person reviews every change and has to judge it in one sitting. So the file needs to read like something a colleague wrote. The agent follows the text exactly as written, at the moment it needs it. So every sentence has to mean what it says and nothing more. Prose that works for the person works for the agent. The reverse isn't true: dense text an agent can parse is text people skip over. Then nobody notices when the text stops matching how we work. The agent follows it, right or wrong.

## Skill anatomy

The `seasoned-skills` npm package keeps its skills under `content/skills/`. A project commits its own under `.claude/skills/`.

- The description tells an agent when to load the skill: what it does, then "Use when …" with the concrete situations. Write it for the reader deciding whether to load, not for the reader already inside.
- The body carries what every use needs. A file under `references/` holds detail read at the step in the body that names it. Helper programs go to `scripts/`.

## What you edit

For CLAUDE.md and every package skill, the file an agent loads is not the file you edit. The `seasoned-skills sync` command generates them from two sources: the package's content, and the project's content files. The seasoned-skills skill teaches that pipeline, from the configuration to a failed sync; load it before you touch a content file.

## Core principles

1. **Sentence case for all headings.** In Title Case, a reader can't tell a name from a word.

2. **Plain speech, no AI dialect.** Words that agents use with each other don't belong in instructions people review. The `seasoned-skills check` command carries the list: it flags each dialect word and prints the plain one beside it. Sometimes a dialect word carries a concept the instructions need. Keep the concept under a plain name and let the word go. Literal identifiers are the one exception. Readers type or search for them as they are. Write `seasoned-skills sync` exactly so, and give the concept a plain name in prose: the sync.

3. **Situation before rule.** Order a file the same way: say what the thing is and how it works before you say how to change it. A rule that comes before its situation looks arbitrary. An agent applies an arbitrary rule everywhere or nowhere.

4. **Specific over vague.** "Run `pnpm test:unit`" beats "run the tests". Skills, commands, files, and models go by their real names: the worktrees skill, never "the skill for branches". A real name is what a reader can search for and load. A coined phrase like "worth its place" sounds like a rule but names no test. Say what the line has to do.

5. **Every rule carries its scope and its reason.** Say when it applies, when it doesn't, and why. The reason lets a reader handle a case you never saw coming.

6. **Define terms on first meeting.** The instructions may teach a term of art, such as lane, or name a tool, such as the sync. The first time a reader meets either, a plain-words definition sits beside it. Name a tool before you describe it and the reader guesses which one.

7. **One home per rule.** A rule lives in exactly one place. Everywhere else that needs it points there. Two copies of one rule drift apart the moment one is edited.

8. **No claims nobody can count.** "Every caller", "all N cases", and "always" are promises prose can't keep over a set nobody counted. Say what guarantees it, and give one example you checked yourself. Keep claims about "all" for sets the text itself defines.

9. **Prefer tooling to prose.** A rule broken once may be chance. Broken twice, the prose isn't holding, and a louder paragraph is more of the same. Build a mechanical guard, or write the case it was broken in as the rule's situation. When a check can enforce the rule, build it and keep only the reason in prose.

10. **Mark the unsettled.** Describe today's way plainly, with "today" in front of it, and say what may change. A reader who takes an unsettled rule as settled applies it after it changes.

11. **One idea per sentence.** Two ideas in one sentence cost a second read. One idea is not one clause: two clauses that belong together stay together.

12. **No sentence that reads wrong first.** "Instructions nobody reviews drift" sends the eye to a noun first. Write "Instructions drift when nobody reviews them."

13. **Active voice where an agent acts.** A passive step hides who acts.

## Where a rule lives

A rule in the wrong home gets restated until the copies disagree, or goes stale where nobody thinks to amend it. Each home has a cost.

- CLAUDE.md loads in every session before anything else. It carries only what every task needs first.
- A skill's description sits in every session's context, used or not, and its body loads whole once an agent judges the situation fits. So a skill needs a situation of its own: one an agent can tell from the description alone, and meets without another skill's work. Rules for one situation that several skills carry belong in a skill for that situation.
- A reference file costs nothing until a step in the body sends the agent to it, so it takes detail that only some uses of the skill need. One no step names is dead text, and the check refuses it.
- Never split a skill for size alone. A part with no situation of its own is one no agent loads.
- Practice that holds across projects lives in the package. A project's own facts live in its content files, workarounds for its tooling included, deleted in the same pull request that fixes what they worked around.
- A lesson from a task never lands in any home directly. It travels as an issue, on the project or on the package, and reaches the text later in a pull request of its own. The self-improvement skill teaches how.

## Size and shape

Every line an agent loads costs tokens on every use. A file too long for one sitting goes without review. So the sync refuses what doesn't fit, naming the generated file, what broke, and this skill. Fix the source: the package's content or the project's content file. The limits:

- word budgets: 2,000 words for a skill body or a reference file, and 2,500 for the generated CLAUDE.md;
- a `name` that matches the skill's folder and uses only lowercase letters, digits, and hyphens;
- a description within 1,024 characters;
- em dashes: none in the front matter, and at most two in any file, since past two the voice reads affected;
- a reading grade of six or lower, as the check computes it, for the body's prose and for the description on its own;
- no dialect word, jargon, hedge such as "may want to consider", or shouting in capitals;
- no heading in Title Case;
- no sentence past 30 words;
- no list nested in another, since each level is one more thing to hold;
- no misspelling, dead link, reference file the body never names, or paragraph repeated from another file;
- no "the … skill" phrase naming a skill by anything but its folder name.

Run `seasoned-skills check` before you commit, so the failure reaches you, not the reviewer. It runs these checks over what the sync would generate, or over any files you name.

When a sentence reads well and still fails, change it so the check passes. Then say in the pull request that the rule may be what to fix.

## The change bar

Every change argues its case in the pull request that carries it, never in the instruction text. The text keeps a rule's scope and its reason, so a reader can apply it. The pull request keeps the case for changing it, so a reviewer can judge it. A sentence like "the list moved out of this file" is the case leaking in. Readers after the merge never had the old version, so it explains nothing.

An addition names the upside it creates or the failure it prevents. A failure counts once it has happened. Anyone can imagine one. The author shows, by searching CLAUDE.md and every skill, that no existing rule says the same thing, and that tooling wouldn't do the job better.

A deletion names why the text is dead. Under a budget, every sentence looks dead. Before you cut one, think hard: what goes wrong without it? If it is a rule, does your cut break it? Five reasons count:

- it made up for a weakness the models or the tooling no longer have;
- it repeats a rule stated elsewhere;
- it teaches what every model already knows, such as what a skill's front matter is;
- tooling now does its job;
- it teaches nothing that creates upside or prevents a failure that has happened.

When a change breaks a budget, make room. Cut what fails the bar, move enforcement to tooling, or move detail to a reference file.

## Reviewing a change to instructions

A review judges whether the change achieves what its author meant, and whether the file still does what it is for. It never matches sentences to rules one by one: findings made that way are each right alone, and together they bloat the file. So the reviewer first understands the file as its owner would: what it does for its reader as a whole, and why each part is there. They understand the change the same way, from the case in the pull request. For a content file, they understand the generated file it feeds. Then they read the whole file as its reader, never the diff.

The author never reviews their own edits: they read what they meant, not what is there. A fresh agent with this skill loaded and no memory of the edits reviews instead. The author answers each finding under the change bar, then hands the file to another fresh agent. The cycle ends when the author is satisfied.

A step an agent copies, like a command, can contradict a principle. Fix one or the other: the step is what the agent follows.

## Voice guide

When a sentence passes every check and still reads like a system talking, see [references/voice-guide.md](references/voice-guide.md).
