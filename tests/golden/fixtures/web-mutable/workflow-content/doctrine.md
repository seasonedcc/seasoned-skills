A field-service platform — work orders, technicians, scheduling, and invoicing in one place. Built on React Router v7, Kysely ORM, and graphile-worker, with a self-contained framework layer in `app/framework/`.

The application schema keeps in-place updates wherever current state is not derivable: a work order carries its status as a column, and correcting a mistyped address is an `UPDATE`. Event tables stay where the business reads a history back. ALWAYS load the `database-design` skill before designing tables, writing migrations, or writing any query that changes data.

## Essential commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # App with hot reload
pnpm run lint         # Biome check
pnpm run tsc          # Type-check
pnpm run test:unit    # Unit tests
pnpm run db:migrate   # Run migrations and regenerate types
```
