The seasoned-skills package: the Seasoned workflow — doctrine, practice skills, an optional stack layer, deterministic code, and corpus machinery — shipped as a public npm package with a command-line tool, so a project adopts the workflow with one install and stays current by upgrading a version. TypeScript on Node; prose lives as markdown fragments and weaving is typed composition code.

## Essential commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Compile the CLI and library to dist/
pnpm run check        # Biome lint + format check
pnpm run tsc          # Type-check
pnpm run test:unit    # Unit tier
pnpm run test:golden  # Golden-output tier (snapshot the generated trees)
pnpm run test         # Both tiers
```

A template or fragment change is reviewed as a diff of what projects will actually receive: the golden tier snapshots the full generated tree per fixture shape, and every tested value of every option is covered by at least one fixture.

## Additional warnings

- The `shaping/` folder is the project's shaping documents, excluded from the gates — never lint, format, or "fix" it as a side effect of package work.
- Reference corpora are never committed: the shaping skill's `references/` tree is built locally by the corpus machinery and stays gitignored.
