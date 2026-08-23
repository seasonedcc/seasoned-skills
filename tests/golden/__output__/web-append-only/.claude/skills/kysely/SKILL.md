---
name: kysely
description: Write Kysely queries and migrations following project conventions. Use when writing migrations, creating tables, adding columns, creating enums, writing database queries with Kysely, or using database transactions.
---

# Kysely

Follow these conventions when writing Kysely queries and migrations in this project. The project uses CamelCasePlugin, which converts all identifiers from camelCase to snake_case automatically.

## INSERT is the only write

The application schema is 100% append-only (load the database-design skill for the full doctrine). Application code never calls `updateTable`, `deleteFrom`, or `truncate` on application tables, and never uses `.onConflict((oc) => oc.doUpdateSet(...))` — an upsert's update arm is an UPDATE. State changes are new event rows; current state is derived at query time (`distinctOn` latest-wins, `EXISTS` checks — see the database-design skill for the canonical derivation patterns).

`.onConflict((oc) => oc.doNothing())` is fine: it makes inserts idempotent without mutating anything.

## Append instead of check-then-branch

The mutable-schema instinct is "check whether a row exists, then insert or update". In an append-only schema there is nothing to branch on: every action appends its event row, and the latest event wins at read time.

Instead of:
```typescript
const existing = await db().selectFrom('invitations').where('email', '=', email).executeTakeFirst()
if (existing) {
  // mutate the existing row's role
} else {
  // insert a new row
}
```

Do:
```typescript
await db()
  .insertInto('invitations')
  .values({ email, role })
  .executeTakeFirstOrThrow()
```

The invitation's current role is derived from the latest invitation event for that email. When an insert must be idempotent (webhooks, retried jobs), add a unique constraint on the natural key and `.onConflict((oc) => oc.doNothing())`.

## Prefer Kysely builder over raw SQL

Use the schema builder for operations Kysely supports natively. Reserve `sql` template literals for things the builder cannot express.

Instead of:
```typescript
await sql`CREATE TYPE document_status AS ENUM ('pending', 'completed', 'failed')`.execute(db)
```

Do:
```typescript
await db.schema
  .createType('documentStatus')
  .asEnum(['pending', 'completed', 'failed'])
  .execute()
```

Instead of:
```typescript
await sql`DROP TYPE document_status`.execute(db)
```

Do:
```typescript
await db.schema.dropType('documentStatus').execute()
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
- **Custom type references in `addColumn`**: `sql`document_status`` (see CamelCasePlugin section below)
- **PostgreSQL functions in queries**: `sql`sha256(bytes)`, `sql`encode(bytes, 'hex')`
- **Complex expressions**: CTEs with raw subqueries, function composition

## CamelCasePlugin awareness

The CamelCasePlugin transforms all identifiers in Kysely builder calls from camelCase to snake_case. Raw SQL via `sql` template literals bypasses the plugin entirely.

This means:
- Builder methods use **camelCase**: `createType('documentStatus')` produces `CREATE TYPE document_status`
- Raw SQL uses **snake_case**: `sql`document_status`` stays as-is

This matters most when referencing custom types in `addColumn` — the type argument goes through `sql`, so it must be snake_case:

```typescript
await db.schema
  .createType('documentStatus')    // camelCase: plugin converts to snake_case
  .asEnum(['pending', 'completed'])
  .execute()

await db.schema
  .createTable('documents')
  .addColumn('status', sql`document_status`, (col) =>  // snake_case: raw SQL, no conversion
    col.notNull().defaultTo('pending'),
  )
  .execute()
```

Two further plugin behaviors that bite:

- **JOIN aliases are rewritten too.** When a query builder joins a table under a camelCase alias, raw `sql` fragments in the same query must reference that alias in snake_case, or the reference silently fails to resolve.
- **jsonb values are re-keyed recursively.** Selecting a jsonb column camelCases the keys *inside* the stored value, not just column names. To read or assert on the real stored keys, select the column cast to text (`sql`(payload -> 'context')::text``) and `JSON.parse` it yourself.

And one Postgres quirk in raw inserts: a bound array literal does not parse into a custom-enum-array column — cast it with `::text[]` in the `sql` template instead of the enum's own array type.

## Parameterized fragments under `.distinct()`

A parameterized `sql` fragment invoked in both a `select` and its `orderBy` binds its parameter twice, and under `.distinct()` Postgres rejects the query (`ORDER BY expressions must appear in select list`) because the two placeholder sets never compare equal. Order by the output alias instead: `.select([fragment(arg).as('name')]).orderBy('name')`.

## Deterministic ordering for display

When a query orders user-visible rows by a non-unique column (a date, a status, a quantity), add a tiebreak on a stable human-meaningful column (a code, a name) before any final `orderBy('id')`. Primary keys are random UUIDs, so an id-only tiebreak renders tied rows in a different order on every database — which reads as arbitrary to users and breaks anything that snapshots the rendered output. Rows tie more often than seed data suggests: real usage produces same-day dates constantly.

```typescript
.orderBy('stockItems.expirationDate', 'asc')
.orderBy('stockItems.code', 'asc')
.orderBy('stockItems.id', 'asc')
```

When the ordered rows come from a union of different kinds — a picker listing items of two kinds — rank the kind ahead of any id (``.orderBy(sql`case when item.kind = 'product' then 0 else 1 end`)``), and leave the human-meaningful tiebreak to separate twins within a kind. A name collides across kinds far more readily than within one, so a kind-blind tiebreak lets two same-named items of different kinds trade places from one database to the next.

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
  .createTable('legalDocuments')  // becomes legal_documents
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

- **Never hand-merge the generated database types file (`types.d.ts`).** After any rebase or conflict, take either side, then regenerate it from a freshly migrated database (`pnpm run db:migrate`) and diff: expect byte-identical or a clean additions-only result. When two open PRs both carry migrations, the one merging second must re-rebase and regenerate after the first lands — git happily auto-merges a semantically wrong types file.
- **`db:rollback` reverts the most-recently-EXECUTED migration on that database, not the highest-timestamped file.** After a rebase, migrations can have run out of filename order, so a rollback may hit someone else's migration. To prove a specific migration's `down()`, use a throwaway database where you control exactly what has run.
- **Prove `down()` against dirtied data, not only a pristine round-trip.** Run the feature (or its tests) so the database holds data only the new schema can represent, then roll back. If the old schema genuinely cannot hold that data, `down()` must fail with a descriptive pre-check error, never a raw constraint violation.
- **Names in the source always equal names in the database.** Postgres silently truncates identifiers past 63 bytes, and the CamelCasePlugin expands compiled index and constraint names — so every declared identifier, including every compiled index and constraint name, must fit the engine's 63-byte limit. A deterministic check enforces this and fails the gate on any identifier the engine would silently truncate: a truncated name is a divergence between source and database that the first future by-name reference (a reindex, a drop, a conflict clause) trips over. Descriptive names still win — the limit is a naming exercise, not information loss.

## Minimize database roundtrips

Compose operations into a single query instead of mixing JS runtime code with multiple database roundtrips. Use returning clauses, subqueries, and CTEs to keep logic in SQL.

### Use `.returning()` instead of separate SELECT after write

Instead of:
```typescript
await db().insertInto('documents').values({ originalFilename }).execute()
const record = await db().selectFrom('documents').where('originalFilename', '=', originalFilename).executeTakeFirstOrThrow()
```

Do:
```typescript
const record = await db()
  .insertInto('documents')
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
const record = await db()
  .insertInto('userLoginTokens')
  .values({ userId, tokenHash })
  .returning('id')
  .executeTakeFirstOrThrow()
const token = randomBytes.toString('hex')
```

Do:
```typescript
const { id, token } = await db()
  .with('random', () => sql`(select gen_random_bytes(32) as bytes)`)
  .insertInto('userLoginTokens')
  .columns(['userId', 'tokenHash'])
  .expression((eb) =>
    eb.selectFrom('random').select(() => [
      sql`${userId}`.as('userId'),
      sql`sha256(bytes)`.as('tokenHash'),
    ]),
  )
  .returning((eb) => [
    'id',
    eb.selectFrom('random').select(() => sql`encode(bytes, 'hex')`.as('encoded')).as('token'),
  ])
  .$castTo<{ id: string; token: string }>()
  .executeTakeFirstOrThrow()
```

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/kysely.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
