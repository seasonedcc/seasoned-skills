A ledger service — double-entry postings, reconciliation, and statement generation behind an HTTP API. It has no interface of its own; the platforms that consume it do.

## Essential commands

```bash
pnpm install          # Install dependencies
pnpm run lint         # Biome check
pnpm run tsc          # Type-check
pnpm run test:unit    # Unit tests
pnpm run test         # Every suite
```

## Additional warnings

- A posting is balanced before it is written. A request that would leave the ledger unbalanced is refused at the boundary, never corrected afterwards.
