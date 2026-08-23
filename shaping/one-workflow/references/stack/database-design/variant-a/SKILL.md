---
name: database-design
description: Design database tables and migrations following project conventions. Use when creating new tables, writing migrations, adding columns, or discussing database schema design.
---

# Database Design

ALWAYS load the "kysely" skill before anything else. Follow these principles when designing database tables and writing migrations for this project.

## Start from healthcare-standard names

Before naming a table, column, or enum for a clinical concept, look up its official name in the international healthcare standards and use that as the starting point:

- **FHIR** (HL7) — resource and field names for clinical data structures: `Observation`, `ServiceRequest`, `Specimen`, `DiagnosticReport`, `Encounter`.
- **LOINC** — codes naming what an observation or lab test measures.
- **UCUM** — units of measure.
- **SNOMED CT** — clinical findings, diagnoses, and procedures.

The product is deliberately not FHIR-compliant — pursuing compliance would be counterproductive. The standards are a vocabulary and modeling reference, not a spec: deviating is fine and often correct, but a deviation must be a conscious product choice, never ignorance of the official term. The canonical example is `customers` instead of FHIR's `Patient`, chosen by design. Record deliberate deviations in the Domain Language section of `architecture.md`.

## Always use `timestamptz`

All timestamp columns must use `timestamptz` (timestamp with time zone), never `timestamp`. The same applies to `timetz` over `time` if time columns are ever needed.

`timestamp` stores a "wall clock" value with no timezone context — the same value can mean different instants depending on the session's `timezone` setting. `timestamptz` stores an unambiguous instant in time (internally UTC), and PostgreSQL automatically converts to/from the session timezone on input/output. This prevents bugs when servers, clients, or sessions use different timezone settings.

Instead of:
```typescript
.addColumn('createdAt', 'timestamp', (col) =>
  col.defaultTo(sql`now()`).notNull(),
)
```

Do:
```typescript
.addColumn('createdAt', 'timestamptz', (col) =>
  col.defaultTo(sql`now()`).notNull(),
)
```

## No nullable columns

Every column in every table must be non-nullable. If data isn't available at insert time, it belongs in a separate event table that gets created when that data becomes available.

Instead of:
```
titles
  id          UUID NOT NULL
  markdown    TEXT          -- nullable, filled after OCR
```

Do:
```
titles
  id          UUID NOT NULL

title_ocr_results
  id          UUID NOT NULL
  title_id    UUID NOT NULL (FK)
  markdown    TEXT NOT NULL
  created_at  TIMESTAMPTZ NOT NULL
```

## No `updatedAt` columns

Never add `updatedAt` to any table. When a timestamp for a state change is needed, create a record in an event table instead. The event's `createdAt` serves as the timestamp for when the change occurred.

Instead of:
```
titles
  id          UUID NOT NULL
  status      TEXT NOT NULL
  updated_at  TIMESTAMP NOT NULL  -- tracks when status changed
```

Do:
```
titles
  id          UUID NOT NULL
  status      TEXT NOT NULL

title_intakes
  id          UUID NOT NULL
  title_id    UUID NOT NULL (FK)
  status      TEXT NOT NULL
  created_at  TIMESTAMPTZ NOT NULL  -- this IS the timestamp
```

## Event tables over nullable columns

As a process progresses through stages, create separate tables for each event rather than updating nullable columns on a parent record. Each event table has its own non-nullable data relevant to that event.

Example for a multi-step pipeline:
```
plot_summaries                    -- main entity
  id, original_filename, created_at

plot_summary_intakes              -- each intake attempt
  id, plot_summary_id, created_at

plot_summary_intake_successes     -- many per intake (reruns allowed)
  id, plot_summary_intake_id, temp_s3_key, created_at

plot_summary_intake_failures      -- many per intake (retries)
  id, plot_summary_intake_id, step, error_message, created_at
```

Status is derived from child records, not stored (see "No derivable columns" below). This pattern extends to each pipeline stage: OCR results, title identifications, etc. Each gets its own event table with non-nullable, stage-specific data.

## No derivable columns

Never store a column whose value can be inferred from the existence of child/event records. If a status is always set alongside inserting an event record, the event record *is* the status — the column is redundant and creates sync risk.

Instead of:
```
plot_summary_intakes
  id, plot_summary_id, status, created_at
  -- status is 'pending' | 'succeeded' | 'failed'
  -- updated to 'succeeded' when a success record is inserted
  -- updated to 'failed' when a failure record is inserted
```

Do:
```
plot_summary_intakes
  id, plot_summary_id, created_at
  -- status derived: success record exists → succeeded
  --                  failure record exists → failed
  --                  neither exists        → pending
```

Derive status at query time using `CASE WHEN ... EXISTS` subqueries or joins when the UI or business logic needs it. Only build the derivation query when actually needed.

## No unique constraints on event table FKs

Event tables (successes, failures, results) must never have unique constraints on the parent foreign key. Allow multiple records per parent so that steps can be rerun and historical results are preserved. The latest record by `createdAt` represents the current state.

Instead of:
```typescript
.addColumn('plotSummaryIntakeId', 'uuid', (col) =>
  col.notNull().unique().references('plotSummaryIntakes.id'),
)
```

Do:
```typescript
.addColumn('plotSummaryIntakeId', 'uuid', (col) =>
  col.notNull().references('plotSummaryIntakes.id'),
)
```

To query the latest result, order by `createdAt desc` and take the first record.

## Mutable columns are fine — when not derivable

Mutable columns that get updated in place are acceptable, as long as their value can't be inferred from child records. A column that is always updated in tandem with inserting an event record is derivable and should be removed.

## Lock discipline across modules

**Disjoint lock keys guard nothing.** A guard that checks "has the concurrent thing already happened" (already-assigned, already-cancelled, still-open) only works if every writer it excludes takes the SAME advisory lock key before the guard's read. A lock on a different key, or a lock somewhere else in the transaction, leaves the race wide open — the writer commits between the guard's read and the guarded write. When adding a cross-module invariant, trace the lock key of every writer that could race it.

**Never call a function that opens its own `db().transaction()` from inside an already-locked transaction.** The inner transaction takes a second pooled connection, which then blocks forever on the advisory lock the outer transaction holds — a deadlock, not an error. If the logic is needed inside a locked transaction, accept a `Transaction<DB>` parameter or inline the write using the function's lower-level helpers.

**Not every check-then-act race needs fixing.** When a review flags an existence check racing a concurrent write, do the harm analysis first: if the raced-in row can never change a value the guard reads (the same predicate that filters the read also excludes it, and it feeds no aggregate the invariant depends on), no derived value can go wrong and the check-then-write idiom is acceptable. Escalate to a shared lock only when the race can corrupt a derived value — and then treat it as a lock-family decision (which writers share the key), not a one-module patch.

## Store full resource locators

When persisting references to external resources (S3 objects, Google Drive files, etc.), store all components needed to locate the resource — not just the key/path. For S3, this means storing the bucket name alongside every S3 key. For Google Drive, it means storing both the file ID and the folder ID.

This makes stored references self-contained. If an environment variable like `AWS_S3_BUCKET` changes, existing records still point to the correct resource.

Instead of:
```
plot_summary_intake_successes
  id            UUID NOT NULL
  temp_s3_key   TEXT NOT NULL
  created_at    TIMESTAMPTZ NOT NULL
```

Do:
```
plot_summary_intake_successes
  id              UUID NOT NULL
  temp_s3_key     TEXT NOT NULL
  temp_s3_bucket  TEXT NOT NULL
  created_at      TIMESTAMPTZ NOT NULL
```

The naming convention pairs each `*S3Key` column with a corresponding `*S3Bucket` column using the same prefix (e.g., `pdfS3Key` / `pdfS3Bucket`, `markdownS3Key` / `markdownS3Bucket`).

## No unnecessary defaults

Only use `defaultTo(...)` for truly auto-generated values like `id` and `createdAt`. When a column has `defaultTo(...)`, Kysely's type generator wraps it in `Generated<T>`, making it optional on insert. This silently loses type safety — forgetting to pass the value won't produce a compiler error.

Instead of:
```typescript
.addColumn('seriesName', 'text', (col) =>
  col.defaultTo('').notNull(),
)
```

Do:
```typescript
.addColumn('seriesName', 'text', (col) =>
  col.notNull(),
)
```

The first generates `seriesName: Generated<string>` (optional on insert). The second generates `seriesName: string` (required on insert), ensuring every insert site is forced to provide the value.

## No cascade deletes

Never use `ON DELETE CASCADE` on foreign keys. Prefer explicit deletes in application code or migrations. Cascade deletes are dangerous because a developer unfamiliar with the schema can accidentally delete large amounts of data by removing a single parent row.

Instead of:
```typescript
.addColumn('resultId', 'uuid', (col) =>
  col.notNull().references('results.id').onDelete('cascade'),
)
```

Do:
```typescript
.addColumn('resultId', 'uuid', (col) =>
  col.notNull().references('results.id'),
)
```

When child records need to be deleted alongside a parent, delete them explicitly in a transaction:

```typescript
await db()
  .transaction()
  .execute(async (trx) => {
    await trx.deleteFrom('childRecords').where('parentId', '=', parentId).execute()
    await trx.deleteFrom('parents').where('id', '=', parentId).execute()
  })
```

## Self-contained migrations

Never import application code (`~/business/`, etc.) in migration files. Migrations are frozen snapshots — they must produce the same result regardless of how the application evolves after they were written.

If a migration needs logic that already exists in the application (e.g., a normalization function for a backfill), duplicate that logic directly inside the migration file. This makes the migration immune to future changes in the imported module.

Instead of:
```typescript
import { buildDedupKey } from '~/business/title-deduplication.server'

export async function up(db: Kysely<any>) {
  // uses buildDedupKey — breaks if the function changes later
}
```

Do:
```typescript
function buildDedupKey(bookName: string, allAuthors: string) {
  return [normalizeMainTitle(bookName), normalizeAuthor(allAuthors)].join(' || ')
}

export async function up(db: Kysely<any>) {
  // uses the local copy — forever frozen
}
```

The only allowed imports in migration files are `kysely` (and its `sql` helper) and Node.js built-in modules.

## Dev seed coverage and the empty-database pre-flight

A schema change is not finished until the dev seed and its pre-flight account for it.

- **A new user-facing product surface ships a dev-seed section and a coverage-manifest entry.** Add a section under `apps/web/app/db/dev-seed/` that seeds the surface's demo-critical state, plus an entry in `apps/web/app/db/dev-seed/coverage-manifest.ts` — either `seeded` with an assertion that the state is queryable, or `declared-unseedable` with a written reason (a live external service or intrinsically transient state). The coverage-manifest test (`dev-seed/coverage.test.ts`) verifies every listed entry against a real seeded database; adding the entry is a Definition of Done requirement, so the surface cannot ship silently un-seeded.
- **Baseline rows planted by a migration must join the pre-flight allowlist.** The dev seed refuses to run against a non-empty application database. If a migration unconditionally inserts rows (a catalog, a default role, seeded content), add its table to the `MIGRATION_SEEDED_TABLES` allowlist in `apps/web/app/db/dev-seed/preflight.ts`, or every seed run — and the coverage test's fresh-migrate step — will abort claiming the database is non-empty. Backfills that select from existing rows leave a fresh database empty and do not need the allowlist.
