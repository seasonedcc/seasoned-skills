---
name: kysely
description: Write Kysely queries and migrations following project conventions. Use when writing migrations, creating tables, adding columns, creating enums, writing database queries with Kysely, or using database transactions.
---

# Kysely

Follow these conventions when writing Kysely queries and migrations in this project. The project uses CamelCasePlugin, which converts all identifiers from camelCase to snake_case automatically.

## Prefer Kysely builder over raw SQL

Use the schema builder for operations Kysely supports natively. Reserve `sql` template literals for things the builder cannot express.

Instead of:
```typescript
await sql`CREATE TYPE plot_summary_status AS ENUM ('pending', 'completed', 'failed')`.execute(db)
```

Do:
```typescript
await db.schema
  .createType('plotSummaryStatus')
  .asEnum(['pending', 'completed', 'failed'])
  .execute()
```

Instead of:
```typescript
await sql`DROP TYPE plot_summary_status`.execute(db)
```

Do:
```typescript
await db.schema.dropType('plotSummaryStatus').execute()
```

Instead of:
```typescript
.addColumn('content', sql`bytea`, (col) => col.notNull())
```

Do:
```typescript
.addColumn('content', 'bytea', (col) => col.notNull())
```

Standard PostgreSQL types that work as string literals: `'text'`, `'integer'`, `'boolean'`, `'uuid'`, `'timestamp'`, `'timestamptz'`, `'bytea'`, `'jsonb'`, `'json'`.

## When raw SQL is appropriate

Use `sql` template literals for:

- **PostgreSQL extensions**: `await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db)`
- **Function calls in defaults**: `col.defaultTo(sql`gen_random_uuid()`)`, `col.defaultTo(sql`now()`)`
- **Custom type references in `addColumn`**: `sql`plot_summary_status`` (see CamelCasePlugin section below)
- **PostgreSQL functions in queries**: `sql`sha256(bytes)`, `sql`encode(bytes, 'hex')`
- **Complex expressions**: CTEs with raw subqueries, function composition

## CamelCasePlugin awareness

The CamelCasePlugin transforms all identifiers in Kysely builder calls from camelCase to snake_case. Raw SQL via `sql` template literals bypasses the plugin entirely.

This means:
- Builder methods use **camelCase**: `createType('plotSummaryStatus')` produces `CREATE TYPE plot_summary_status`
- Raw SQL uses **snake_case**: `sql`plot_summary_status`` stays as-is

This matters most when referencing custom types in `addColumn` — the type argument goes through `sql`, so it must be snake_case:

```typescript
await db.schema
  .createType('plotSummaryStatus')    // camelCase: plugin converts to snake_case
  .asEnum(['pending', 'completed'])
  .execute()

await db.schema
  .createTable('plotSummaries')
  .addColumn('status', sql`plot_summary_status`, (col) =>  // snake_case: raw SQL, no conversion
    col.notNull().defaultTo('pending'),
  )
  .execute()
```

Two further plugin behaviors that bite:

- **JOIN aliases are rewritten too.** When a query builder joins a table under a camelCase alias, raw `sql` fragments in the same query must reference that alias in snake_case, or the reference silently fails to resolve.
- **jsonb values are re-keyed recursively.** Selecting a jsonb column camelCases the keys *inside* the stored value, not just column names. To read or assert on the real stored keys, select the column cast to text (`sql`(payload -> 'context')::text``) and `JSON.parse` it yourself.

And one Postgres quirk in raw inserts: a bound array literal does not parse into a custom-enum-array column — cast it with `::text[]` in the `sql` template instead of the enum's own array type.

## Always await `.execute()`

Every Kysely operation that calls `.execute()` must be awaited. Missing `await` creates race conditions where subsequent operations may run before the current one finishes.

Instead of:
```typescript
sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db)

await db.schema.createTable('users')  // may run before extension is created
```

Do:
```typescript
await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db)

await db.schema.createTable('users')
```

## camelCase in migrations

Use camelCase for all identifiers in Kysely builder calls — table names, column names, type names, constraint names, index names. The CamelCasePlugin converts them to snake_case in the generated SQL. Only use snake_case when writing raw SQL strings.

```typescript
await db.schema
  .createTable('plotSummaries')       // becomes plot_summaries
  .addColumn('id', 'uuid', (col) =>
    col.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
  )
  .addColumn('originalFilename', 'text', (col) => col.notNull())  // becomes original_filename
  .addColumn('createdAt', 'timestamp', (col) =>                   // becomes created_at
    col.defaultTo(sql`now()`).notNull(),
  )
  .execute()
```

## No application imports in migrations

Migration files must only import from `kysely` and Node.js built-ins. Never import from `~/business/` or any other application code. If a migration needs application logic (e.g., for a data backfill), duplicate that logic inside the migration file. See the database-design skill for the full rationale.

## Proving migrations and regenerating types

- **Never hand-merge `apps/web/app/db/types.d.ts`.** After any rebase or conflict, take either side, then regenerate it from a freshly migrated database (`pnpm run db:migrate`) and diff: expect byte-identical or a clean additions-only result. When two open PRs both carry migrations, the one merging second must re-rebase and regenerate after the first lands — git happily auto-merges a semantically wrong types file.
- **`db:rollback` reverts the most-recently-EXECUTED migration on that database, not the highest-timestamped file.** After a rebase, migrations can have run out of filename order, so a rollback may hit someone else's migration. To prove a specific migration's `down()`, use a throwaway database where you control exactly what has run.
- **Prove `down()` against dirtied data, not only a pristine round-trip.** Run the feature (or its tests) so the database holds data only the new schema can represent, then roll back. If the old schema genuinely cannot hold that data, `down()` must fail with a descriptive pre-check error, never a raw constraint violation.
- Postgres truncates identifiers longer than 63 bytes silently — check compiled index/constraint names, which the CamelCasePlugin expands.

## Minimize database roundtrips

Compose operations into a single query instead of mixing JS runtime code with multiple database roundtrips. Use upserts, returning clauses, subqueries, and CTEs to keep logic in SQL.

### Use `.onConflict()` instead of check-then-insert

Instead of:
```typescript
const existing = await db().selectFrom('invitations').where('email', '=', email).executeTakeFirst()
if (existing) {
  await db().updateTable('invitations').set({ role }).where('id', '=', existing.id).execute()
} else {
  await db().insertInto('invitations').values({ email, role }).execute()
}
```

Do:
```typescript
await db()
  .insertInto('invitations')
  .values({ email, role })
  .onConflict((oc) => oc.column('email').doUpdateSet({ role }))
  .executeTakeFirstOrThrow()
```

### Use `.returning()` instead of separate SELECT after write

Instead of:
```typescript
await db().insertInto('plotSummaries').values({ originalFilename }).execute()
const record = await db().selectFrom('plotSummaries').where('originalFilename', '=', originalFilename).executeTakeFirstOrThrow()
```

Do:
```typescript
const record = await db()
  .insertInto('plotSummaries')
  .values({ originalFilename })
  .returning(['id', 'originalFilename', 'createdAt'])
  .executeTakeFirstOrThrow()
```

### Use subqueries in `.values()` and `.set()` instead of fetching into JS

Instead of:
```typescript
const tab = await db().selectFrom('tabs').select('name').where('id', '=', tabId).executeTakeFirstOrThrow()
await db().insertInto('logs').values({ tabId, tabName: tab.name, action }).execute()
```

Do:
```typescript
await db()
  .insertInto('logs')
  .values((eb) => ({
    tabId,
    tabName: eb.selectFrom('tabs').select('name').where('id', '=', tabId),
    action,
  }))
  .execute()
```

### Use transactions for multi-step operations

When multiple queries must succeed or fail together, wrap them in a transaction. The callback receives a `trx` object — use it instead of `db()` for all queries inside:

```typescript
const intake = await db()
  .transaction()
  .execute(async (trx) => {
    const record = await trx
      .insertInto('records')
      .values({ name: 'example' })
      .returning('id')
      .executeTakeFirstOrThrow()

    return await trx
      .insertInto('intakes')
      .values({ recordId: record.id })
      .returning('id')
      .executeTakeFirstOrThrow()
  })

// intake is available here after the transaction commits
```

Transactions auto-rollback on exceptions. The return value of the callback becomes the return value of `.execute()`, making it easy to pass data out after commit.

To share transaction-aware logic across functions, accept `trx: Transaction<DB>` as a parameter:

```typescript
import type { Transaction } from 'kysely'
import type { DB } from '~/db/types'

async function insertRecordWithIntake(trx: Transaction<DB>, name: string) {
  const record = await trx
    .insertInto('records')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()

  return await trx
    .insertInto('intakes')
    .values({ recordId: record.id })
    .returning('id')
    .executeTakeFirstOrThrow()
}
```

### Use `case()` builder for conditional computed columns

Use Kysely's expression builder `case()` for SQL CASE expressions instead of deriving values in JS after the query. This keeps logic in SQL and avoids extra `.map()` post-processing.

```typescript
.select((eb) =>
  eb
    .case()
    .when(eb('lockedAt', 'is not', null))
    .then('running')
    .when(
      eb.and([
        eb('attempts', '>=', eb.ref('maxAttempts')),
        eb('lastError', 'is not', null),
      ]),
    )
    .then('failed')
    .when(
      eb.and([
        eb('lockedAt', 'is', null),
        eb('runAt', '>', sql<Date>`now()`),
      ]),
    )
    .then('scheduled')
    .else('pending')
    .end()
    .$castTo<JobStatus>()
    .as('status'),
)
```

Key patterns:
- `eb.and([...])` / `eb.or([...])` for compound conditions
- `eb.ref('columnName')` for column-to-column comparisons (right-hand side)
- `$castTo<Type>()` to narrow the result type (e.g., a union of string literals)
- Mix `eb()` (camelCase, goes through CamelCasePlugin) with `sql` template literals (snake_case) for PostgreSQL functions

### Type-annotate `sql` template literals used as `eb()` operands

When a `sql` template literal is used as the right-hand operand of an `eb()` comparison, it must have a type annotation matching the column's type. Without it, TypeScript infers `RawBuilder<unknown>` which is not assignable to the expected operand type.

Instead of:
```typescript
eb('attempts', '<', sql`coalesce(max_attempts, 25)`)  // TS error: RawBuilder<unknown>
eb('runAt', '>', sql`now()`)                           // TS error: RawBuilder<unknown>
```

Do:
```typescript
eb('attempts', '<', sql<number>`coalesce(max_attempts, 25)`)
eb('runAt', '>', sql<Date>`now()`)
```

Match the type annotation to the column's TypeScript type (`number` for numeric columns, `Date` for timestamp columns, `string` for text columns, etc.).

### Use CTEs with `.with()` to generate data once and reference it across the query

Instead of:
```typescript
const randomBytes = crypto.randomBytes(32)
const tokenHash = crypto.createHash('sha256').update(randomBytes).digest()
const user = await db()
  .insertInto('users')
  .values({ email, emailAuthHash: tokenHash })
  .onConflict((oc) => oc.column('email').doUpdateSet({ emailAuthHash: tokenHash }))
  .returning('id')
  .executeTakeFirstOrThrow()
const token = randomBytes.toString('hex')
```

Do:
```typescript
const { id, token } = await db()
  .with('random', () => sql`(select gen_random_bytes(32) as bytes)`)
  .insertInto('users')
  .columns(['email', 'emailAuthHash'])
  .expression((eb) =>
    eb.selectFrom('random').select(() => [
      sql`${email}`.as('email'),
      sql`sha256(bytes)`.as('emailAuthHash'),
    ]),
  )
  .onConflict((oc) =>
    oc.column('email').doUpdateSet({
      emailAuthHash: sql`(select sha256(bytes) from random)`,
    }),
  )
  .returning((eb) => [
    'id',
    eb.selectFrom('random').select(() => sql`encode(bytes, 'hex')`.as('encoded')).as('token'),
  ])
  .$castTo<{ id: string; token: string }>()
  .executeTakeFirstOrThrow()
```
