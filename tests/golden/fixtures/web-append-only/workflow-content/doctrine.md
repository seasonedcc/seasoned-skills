An operations platform — production, inventory, procurement, and sales in one place, multi-company by design. Built on React Router v7, Kysely ORM, and graphile-worker, with a self-contained framework layer in `app/framework/`.

The application schema is 100% append-only and event-sourced, with zero exceptions: `INSERT` is the only write, current state is derived from events at query time, and deletion/archival/correction are events too. ALWAYS load the `database-design` skill before designing tables, writing migrations, or writing any query that changes data.

## Essential commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # App with hot reload (app on :7000, maildev UI on :1080)
pnpm run dev:worker   # The graphile-worker process (needed for auth emails)
pnpm run lint         # Biome check
pnpm run tsc          # Type-check
pnpm run test:unit    # Unit tests
pnpm run db:migrate   # Run migrations and regenerate types
```

## Responsive bar

Primary actions render full-size below the `xl` breakpoint, per the design-system guidelines' responsive canon.

## Additional warnings

- DO NOT change dependency arrays just to make the linter happy or to follow React "best practices". You'll create infinite render loops. Only add things to dependency arrays when they really need to be there.
