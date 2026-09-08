# Checks over the instructions agents read

This folder is the working copy of the checks the shaping document describes in its "size and shape" element: the shape checks, the reading-grade ceiling, and the prose linter in two tiers. It runs today over the skills drafted beside it, and the build installs it as the checks behind `seasoned-skills check` and the sync.

## What each file is

- `check.mjs` is the runner. Give it markdown files. It checks the front matter (name, description length, description reading grade, no em dashes), the em dash ration, the reading grade of the body, links between files, skill names against the roster, and terms of art defined on first use. Then it runs Vale, cspell, and jscpd and reports everything in one list. It exits non-zero when an error remains. Warnings and suggestions never fail the run: they are questions the writer answers in the pull request.
- `.vale.ini` points Vale at the style below and lets every level through.
- `styles/Seasoned/` holds the prose rules, one file each. The rules that fail the file: `Dialect` (the translation table), `Jargon`, `Hedging`, `Shouting`, `DashSpacing`, `HeadingCase`, and `SentenceLength` (30 words). The rules that only warn: `Passive`, `Vague`, `Universal`, `Clauses`, `Surface`. `Contractions` is a suggestion.
- `cspell.json` is the spelling dictionary. Add a word here when it is a real name the dictionary lacks.

The roster comes from the folders in `.claude/skills` and `content/skills` above this folder, plus the folder of every SKILL.md being checked. Every roster name is also a word the spelling check accepts.

## What the first runs taught

- Vale never reads YAML front matter, so the runner lints the description on its own by feeding it to Vale over standard input.
- Vale's `paragraph`, `list`, and `heading` scopes leave table cells alone, which is what keeps the translation table from failing its own rule. It also means a table anywhere escapes the prose rules.
- A part-of-speech rule for words that read as both noun and verb flagged nearly every noun, so it is not here. The tagger falls into the same traps a reader does.
- The universal-claim rule as a plain word list ("every", "all", "always") flagged dozens of ordinary sentences. It now matches only claim-shaped phrases such as "every caller" and "in all cases".
- Contractions for "it is", "that is", and "there is" were more often wrong than right, so those three are not suggested.
- The passive rule reads "is gone" and "were settled" as passive. Those are listed as exceptions.
- Under pnpm 10, the `@vvago/vale` package needs its build step approved in `package.json` (`pnpm.onlyBuiltDependencies`), or the binary is never downloaded.
- A section that quotes what it bans, such as a list of jargon words, fails the rule that bans it. The list has to live in the rule, with the prose pointing at it.

## Running it

```sh
node shaping/cohesive-precise-and-lean-skills/references/checks/check.mjs <files>
```
