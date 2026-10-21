# Checks over the instructions agents read

This folder is the working copy of the checks the shaping document describes in its "size and shape" element: the shape checks, the reading-grade ceiling, and the prose linter. It runs today over the skills drafted beside it, and the build installs it as the checks behind `seasoned-skills check` and the sync.

Every check fails the file. There are no warnings: a rule that could not be made exact on our own files was deleted rather than demoted, and the list below records which ones and why.

## What each file is

- `check.ts` is the runner, TypeScript that Node 22 runs as is. Give it markdown files. It checks the front matter (name, description length, description reading grade, no em dashes), the word budget (2,000 words for a skill body, everything below the front matter, since the name and description have caps of their own; 2,000 for a file under `references/`; 2,500 for a CLAUDE.md; a word is a whitespace-separated token holding a letter or a digit, so code counts and list markers do not), the em dash ration, the reading grade of the body, sentence case in headings, links between files, and skill names against the roster. Then it runs Vale, cspell, and jscpd and reports everything in one list, exiting non-zero when anything failed.
- `.vale.ini` points Vale at the style below.
- `styles/Seasoned/` holds the prose rules, one file each: `Dialect` (the translation table, `surface` included), `Jargon`, `Hedging`, `Shouting`, `DashSpacing`, and `SentenceLength` (30 words).
- `text-readability.d.ts` declares the four functions the runner uses from the readability library, which ships no types.
- `cspell.json` is the spelling dictionary. Add a word there when it is a real term the dictionary lacks, and say so in the pull request.

The roster comes from the folders in `.claude/skills` and `content/skills` above this folder, plus the folder of every SKILL.md being checked. Every roster name is also a word the spelling check accepts.

Text inside double quotes is a mention, not a use, and the word rules skip it. That is how a rule can quote the phrase it bans.

## What the runs taught

The rules were run over the package's 33 skills, its docs, and its README, about 74,000 words, and every rule's hits were sampled by hand. Kept as strict, because every sampled hit was real: dialect, jargon minus one word, hedging, shouting minus one word, dash spacing, sentence length, heading case, links, duplicates, spelling, and the roster names with a short stop-list of ordinary adjectives such as "same" and "generic".

Deleted, with the sampled precision that sank them:

- Passive voice: 523 hits, almost none a defect. "Contention is managed by the orchestrator's own scheduling" is fine prose. A narrow form, "must be updated" with no actor, was right only half the time.
- Vague quantifiers such as "many" and "several": 37 hits, nearly all in sentences where no number exists to give.
- Universal claims such as "every case": 8 hits, two of them real.
- Commas per sentence as a proxy for too many ideas: 204 hits, all lists and asides.
- Contractions: a matter of voice, and "is not" is often emphasis.
- A term-of-art-defined-first heuristic: never measured, so never trusted.
- A part-of-speech rule for words that read as both noun and verb: it flagged nearly every noun. The tagger falls into the same traps a reader does.
- "solution" left the jargon list: 20 of its 23 hits were the word's plain meaning, as in the shaping skill's problem and solution.
- Lowercase "critical" left the shouting list: "critical section" is a term.

Facts about the tools:

- Vale does not end a sentence at a file name such as `CLAUDE.md.`, so two sentences merge and the length rule flags the pair. The runner rewrites the extension's dot to a hyphen when sentence punctuation follows it, before Vale reads the text; the line count and every other character stay the same.
- Vale never reads YAML front matter, so the runner feeds every file to Vale over standard input, with quoted mentions blanked and line numbers preserved, and lints the description the same way.
- Vale's `paragraph`, `list`, and `heading` scopes leave table cells alone, so a table anywhere escapes the prose rules.
- Vale's own capitalization rule could not tell an identifier from a lowercase word, so heading case lives in the runner: a heading starts with a capital unless its first word is an identifier, and every later word is lowercase unless it is an identifier, an acronym, or a proper noun the runner lists.
- Under pnpm 10, the `@vvago/vale` package needs its build step approved in `package.json` (`pnpm.onlyBuiltDependencies`), or the binary is never downloaded.
- A section that quotes what it bans fails the rule that bans it, unless the quote is in double quotes. Lists of banned words live in the rules, with the prose pointing at them.

## Running it

```sh
node shaping/cohesive-precise-and-lean-skills/references/checks/check.ts <files>
```

## Nested lists and list items as sentences

A list item nested inside another fails the file (`nested-list`). Lists stay flat: split the outer list under subheadings, or rewrite the items as prose.

The grade check reads each list item as a sentence of its own. Before this, items ending in a semicolon and starting lowercase merged into one long sentence, and the grade rose for a list a reader takes item by item.

## Orphan reference files

Every file under a skill's `references/` folder must be named by path somewhere in the skill's body (`orphan-reference`), since a reference file is only ever read at the step that names it. Today the testing skill's `references/examples.md` fails this.
