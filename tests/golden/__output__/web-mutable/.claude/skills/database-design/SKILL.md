---
name: database-design
description: Design database tables and migrations following the project's identity-and-event-table doctrine. Use when creating new tables, writing migrations, adding columns, modeling state changes, deriving current state, or discussing database schema design.
---

# Database Design

ALWAYS load the "kysely" skill before anything else. Follow these principles when designing database tables and writing migrations for this project.

## Mutable columns are fine — when not derivable

Mutable columns that get updated in place are acceptable, as long as their value can't be inferred from child records. A column that is always updated in tandem with inserting an event record is derivable and should be removed.

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

## Two kinds of tables

Every application table is one of two kinds:

**Identity tables** hold what is immutable by design: `id`, `createdAt`, and ownership foreign keys that can never change (e.g., `companyId` — a product never moves to another company).

**Event tables** hold everything that happens to an entity after (and including) its birth. Each event row is a fact that occurred at `createdAt` and is never modified.

```
products                      -- identity: who exists
  id          UUID PK
  company_id  UUID NOT NULL (FK)
  created_at  TIMESTAMPTZ NOT NULL

product_revisions             -- event: what the product's details are
  id          UUID PK
  product_id  UUID NOT NULL (FK)
  name        TEXT NOT NULL
  sku         TEXT NOT NULL
  unit_id     UUID NOT NULL (FK)
  created_at  TIMESTAMPTZ NOT NULL   -- latest revision wins

product_archivals             -- event: the product was archived
  id          UUID PK
  product_id  UUID NOT NULL (FK)
  created_at  TIMESTAMPTZ NOT NULL
```

## Event tables: one per cohesive concern

Slice mutable state into event tables **per cohesive concern** — fields that change together through one user action share one table:

- A "revision" table snapshots all fields of its concern per edit. The product "edit details" form (name, sku, unit) writes one `product_revisions` row carrying **all** those fields — full snapshot, not a diff — so reading current state needs only the latest row.
- Separately-actioned state changes each get their own narrow event table: `product_archivals`, `order_submissions`, `invoice_approvals`.
- Not per-field (table explosion, N-way joins to assemble current state), and not forced whole-entity (couples unrelated concerns into one table).

**Creation is a transaction**: inserting an entity writes the identity row plus the first row of each relevant event table in one transaction. "Latest event wins" then needs no special case for freshly created entities, and no column ever needs to be nullable while "waiting" for data.

**Naming**: identity tables are plural nouns (`products`); event tables are `<entity>_<past-action-plural>` (`product_revisions`, `order_approvals`, `user_session_revocations`).

## One-way events and paired toggles

Model each state transition by its real shape:

- **One-way transitions** (revocation, completion, cancellation, termination): a single event table; the existence of a row *is* the state. A `user_session_revocations` row means the session is revoked, forever.
- **Reversible toggles** (archive/restore, activate/deactivate, grant/revoke): a pair of event tables; the newer of the two latest events wins. Each direction can carry direction-specific data (e.g., a restoration's reason).

```typescript
const archivalEvents = db()
  .selectFrom('productArchivals')
  .select(['productId', 'createdAt', sql<boolean>`true`.as('archived')])
  .unionAll(
    db()
      .selectFrom('productRestorations')
      .select(['productId', 'createdAt', sql<boolean>`false`.as('archived')])
  )
```

Take the latest row per `productId` to know whether the product is archived; no rows means never archived.

## Deriving current state

Current state is always computed at query time from events. The canonical patterns:

**Latest event wins** — `DISTINCT ON` ordered by recency:

```typescript
db()
  .selectFrom('productRevisions')
  .distinctOn('productId')
  .orderBy('productId')
  .orderBy('createdAt', 'desc')
  .orderBy('id', 'desc')
  .selectAll()
```

The `id desc` tie-break makes ordering deterministic if two events ever share a timestamp — but avoid creating that situation: one user action appends one event per parent per transaction.

**Existence is state** — `EXISTS` / `NOT EXISTS`:

```typescript
.where(({ not, exists, selectFrom }) =>
  not(
    exists(
      selectFrom('userSessionRevocations')
        .select('id')
        .whereRef('userSessionRevocations.userSessionId', '=', 'userSessions.id')
    )
  )
)
```

**Aggregates over events** — quantities are sums of movements, never stored balances:

```typescript
db()
  .selectFrom('stockMovements')
  .select(({ fn }) => fn.sum<string>('quantityDelta').as('onHand'))
  .where('stockItemId', '=', stockItemId)
```

**Status from event existence** — `CASE WHEN ... EXISTS` chains: success event exists → succeeded, failure event exists → failed, neither → pending. Only build the derivation query when the UI or business logic actually needs it.

**Indexes**: every event table gets an index on `(parentId, createdAt desc)` at creation time — it serves every latest-wins and existence query.

## Ordering absolute-set events

Most derivations are order-insensitive (sums) or single-writer latest-wins (revisions). But when an event family mixes **delta events** (movements) with **absolute-set events** (count adjustments) over the same derived value, the derivation is latest-absolute-wins plus later deltas — and "later" must mean **commit order**, not transaction-begin order. `now()` is frozen at `BEGIN`, so a slow transaction can stamp an event *before* an absolute-set that never saw it, and the derivation silently drops the delta.

The rule, for any event family with at least one absolute-set consumer:

1. Every writer of every event in the family takes the **same advisory lock** (`pg_advisory_xact_lock`, org-scoped) before inserting, so critical sections are disjoint and inserts happen in commit order.
2. The ordering column (`createdAt`) defaults to **`clock_timestamp()`**, not `now()`, so the stamp is taken inside the locked section.
3. Absolute-set comparisons use strict `>`; equal stamps cannot occur across transactions under the lock, and one transaction never writes both an absolute-set and a delta for the same derived cell.

An inventory family mixing movement deltas (`stock_inbound_movements`, `stock_outbound_movements`, `stock_transfers`) with `stock_count_adjustments` is the canonical shape. Give the shared lock one helper function with one home, and have every writer in the family — including any new one — take it. If clock monotonicity on the database host ever becomes a real concern, the escalation path is a shared monotonic sequence assigned under the same lock — a new keyed structure, never a rewrite of existing rows.

## Lock discipline across modules

**Disjoint lock keys guard nothing.** A guard that checks "has the concurrent thing already happened" (has-receipts, has-shipments, is-discarded) only works if every writer it excludes takes the SAME advisory lock key before the guard's read. A lock on a different key, or a lock somewhere else in the transaction, leaves the race wide open — the writer commits between the guard's read and the guarded write. When adding a cross-module invariant, trace the lock key of every writer that could race it.

**Never call a function that opens its own `db().transaction()` from inside an already-locked transaction.** The inner transaction takes a second pooled connection, which then blocks forever on the advisory lock the outer transaction holds — a deadlock, not an error. If the logic is needed inside a locked transaction, accept a `Transaction<DB>` parameter or inline the write using the function's lower-level helpers.

**Not every check-then-act race needs fixing.** When a review flags an existence check racing a concurrent write, do the harm analysis first: if the raced-in row can never change a value the guard reads (the same predicate that filters the read also excludes it, and it feeds no aggregate the invariant depends on), no derived value can go wrong and the check-then-write idiom is acceptable. Escalate to a shared lock only when the race can corrupt a derived value — and then treat it as a lock-family decision (which writers share the key), not a one-module patch.

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

An event table's `createdAt` *is* the event time — the timestamp every derivation orders by.

## No nullable columns — zero exceptions

Every column in every table must be non-nullable. If data isn't available at insert time, it belongs in a separate event table that gets created when that data becomes available.

Instead of:
```
documents
  id          UUID NOT NULL
  markdown    TEXT          -- nullable, filled after OCR
```

Do:
```
documents
  id          UUID NOT NULL

document_ocr_results
  id          UUID NOT NULL
  document_id UUID NOT NULL (FK)
  markdown    TEXT NOT NULL
  created_at  TIMESTAMPTZ NOT NULL
```

"Optional" attributes are not nullable columns either: model them as their own event table with zero-or-more rows per parent.

## No `updatedAt` columns

Never add `updatedAt` to any table. When a timestamp for a state change is needed, the event row's `createdAt` *is* the timestamp for when the change occurred.

## No derivable columns

Never store a column whose value can be inferred from event records. If a status is always set alongside inserting an event record, the event record *is* the status — the column is redundant and creates sync risk. This is why identity tables carry no `status`, no `archived`, no `current*` columns: all of it derives from events.

Instead of:
```
document_intakes
  id, document_id, status, created_at
  -- status is 'pending' | 'succeeded' | 'failed'
```

Do:
```
document_intakes
  id, document_id, created_at
  -- status derived: success record exists → succeeded
  --                  failure record exists → failed
  --                  neither exists        → pending
```

## No unique constraints on event table FKs

Event tables must never have unique constraints on the parent foreign key. Allow multiple records per parent so that actions can be rerun and historical results are preserved. The latest record by `createdAt` represents the current state.

Instead of:
```typescript
.addColumn('documentIntakeId', 'uuid', (col) =>
  col.notNull().unique().references('documentIntakes.id'),
)
```

Do:
```typescript
.addColumn('documentIntakeId', 'uuid', (col) =>
  col.notNull().references('documentIntakes.id'),
)
```

## No unnecessary defaults

Only use `defaultTo(...)` for truly auto-generated values like `id` and `createdAt`. When a column has `defaultTo(...)`, Kysely's type generator wraps it in `Generated<T>`, making it optional on insert. This silently loses type safety — forgetting to pass the value won't produce a compiler error.

Instead of:
```typescript
.addColumn('displayName', 'text', (col) =>
  col.defaultTo('').notNull(),
)
```

Do:
```typescript
.addColumn('displayName', 'text', (col) =>
  col.notNull(),
)
```

The first generates `displayName: Generated<string>` (optional on insert). The second generates `displayName: string` (required on insert), ensuring every insert site is forced to provide the value.

## Store full resource locators

When persisting references to external resources (S3 objects, Google Drive files, etc.), store all components needed to locate the resource — not just the key/path. For S3, this means storing the bucket name alongside every S3 key. For Google Drive, it means storing both the file ID and the folder ID.

This makes stored references self-contained. If an environment variable like `AWS_S3_BUCKET` changes, existing records still point to the correct resource.

Instead of:
```
document_intake_successes
  id            UUID NOT NULL
  temp_s3_key   TEXT NOT NULL
  created_at    TIMESTAMPTZ NOT NULL
```

Do:
```
document_intake_successes
  id              UUID NOT NULL
  temp_s3_key     TEXT NOT NULL
  temp_s3_bucket  TEXT NOT NULL
  created_at      TIMESTAMPTZ NOT NULL
```

The naming convention pairs each `*S3Key` column with a corresponding `*S3Bucket` column using the same prefix (e.g., `pdfS3Key` / `pdfS3Bucket`, `markdownS3Key` / `markdownS3Bucket`).

## Self-contained migrations

Never import application code (`~/business/`, etc.) in migration files. Migrations are frozen snapshots — they must produce the same result regardless of how the application evolves after they were written.

If a migration needs logic that already exists in the application (e.g., a normalization function for a backfill), duplicate that logic directly inside the migration file. This makes the migration immune to future changes in the imported module.

The only allowed imports in migration files are `kysely` (and its `sql` helper) and Node.js built-in modules.

## Performance: derive first, then escalate

Query-time derivation is the default and stays the default until a real query is measurably slow. When that happens, escalate in strict order:

1. **`EXPLAIN ANALYZE` and indexes.** Most latest-wins and existence derivations are index problems. Composite `(parentId, createdAt desc)` indexes, partial indexes, and covering indexes go a very long way.
2. **Partitioned tables.** High-volume event tables (stock movements, processing heartbeats) partition naturally by time range. Declarative partitioning keeps hot partitions small without changing the write path or the doctrine.
3. **A read-side materialized-view layer.** When a derivation must be served near real time and is beyond what indexes and partitions can do, the escalation is a streaming engine (RisingWave or similar) ingesting Postgres events and maintaining incrementally-updated materialized views — a pure read-side layer, rebuildable from Postgres at any time, never written back into the application schema. Do not add this layer, plan for it, or design around it until the first two rungs are exhausted on a real, measured bottleneck.

Never write a derived value back into the application schema from application code — a cache that lives in an app table is a mutable column with extra steps.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/database-design.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
