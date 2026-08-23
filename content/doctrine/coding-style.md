## Coding style

- Do not add backwards compatibility to plans or implementations unless you are 100% confident it is necessary. Unnecessary compatibility only adds complexity{{backwards-compat-contracts}}
- Do not add comments to the code unless it's an incredibly complex operation
- Avoid abbreviations when naming things. That goes for SQL statements as well.
- Avoid Hasty Abstractions: it is OK to repeat things here and there until the right abstraction emerges.
- Only extract abstractions to new files if you need to share them among more than one file. Otherwise, extract them in the same file.
- Follow the surrounding repo's conventions for everything else — its linter config, naming, and idiom are the local law.
