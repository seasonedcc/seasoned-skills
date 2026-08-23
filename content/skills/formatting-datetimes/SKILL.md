---
name: formatting-datetimes
description: Format dates and timestamps in SQL queries instead of JS Date instances. Use when rendering dates, date/times, timestamps, or times from the database, when user mentions date formatting, toLocaleDateString, toLocaleString, or timezone issues, or when working with SSR hydration mismatches involving dates.
---

# Formatting Datetimes

Format all date/time values from the database in SQL using PostgreSQL's `to_char()` and return pre-formatted strings. Never rely on JS `Date` instances for display.

## Why

1. **SSR hydration mismatch**: `toLocaleDateString()` and `toLocaleString()` produce different output on the server (Node.js locale/timezone) vs the client (browser locale/timezone), causing React hydration errors.
2. **Timezone ambiguity**: The browser's locale and timezone determine the output, making it unpredictable. Formatting in SQL with the database's session timezone (UTC) as the source of truth eliminates ambiguity.

## Database timezone

The database session timezone is set to UTC via `SET timezone TO 'UTC'` on every connection (`app/framework/db.server.ts`).

## Format patterns

### Date only

For values displayed without time, use `'YYYY-MM-DD'`:

```typescript
sql<string>`to_char(created_at, 'YYYY-MM-DD')`.as('createdAt')
```

Output: `2026-02-22`

### Datetime in UTC (admin/debug)

For admin/debug values rendered in UTC (job `runAt`, audit trails), always include the `TZ` format specifier so the timezone appears in the output:

```typescript
sql<string | null>`to_char(run_at, 'YYYY-MM-DD HH24:MI TZ')`.as('runAt')
```

Output: `2026-02-22 14:30 UTC`

### Local display

User-facing labels on local surfaces are formatted at the project's display time zone, WITHOUT the `TZ` suffix — the local zone is implied:

```typescript
sql<string>`to_char(scheduled_at at time zone ${sql.lit(timezone)}, 'HH24:MI')`.as('scheduledTime')
```

Output: `14:30`

Which zone that is comes from the project's time-zone model — tenant-configurable or a constant:

{{time-zone-model}}

Whatever the model, the zone string is passed in — never hardcoded at a call site — and when the zone is data rather than a constant, every write path validates it against a strict whitelist backed by `Intl.supportedValuesOf('timeZone')` before it can ever reach `sql.lit`. Routes carry no time-zone knowledge beyond threading the resolved zone.

## `timestamp` vs `timestamptz` columns

- **`timestamptz`** columns: `to_char(..., '... TZ')` works directly — the timezone abbreviation comes from the session timezone.
- **`timestamp`** (without timezone) columns: The `TZ` specifier won't produce output. If timezone is needed, cast first: `to_char(created_at::timestamptz, '... TZ')`. Since the session timezone is UTC, the cast interprets the naive timestamp as UTC.

For date-only formatting, no cast is needed regardless of column type.

## Never wrap a plain `date` column in `AT TIME ZONE`

A `date` column has no time-of-day to convert. Wrapping it in `AT TIME ZONE` makes Postgres cast it to a timestamp at **UTC midnight first** and then shift it — landing on the previous calendar day for any zone west of UTC, in both DST arms. The law:

- `timestamptz` columns: `at time zone <zone>` first, then cast `::date` if a local calendar day is needed.
- `date` columns: use as-is. No `AT TIME ZONE`, ever.

Every derivation with a day boundary (expiration, lot numbering, "today" comparisons, week windows) gets a test asserting the **exact calendar day** on both sides of a zone-adjacent boundary — two UTC instants that land on different local dates. Bucket assertions (±N days) cannot catch a one-day shift.

## Component rendering

Since values arrive as pre-formatted strings, render them directly:

Instead of:
```tsx
{new Date(record.createdAt).toLocaleDateString()}
```

Do:
```tsx
{record.createdAt}
```

## Move Date comparisons to SQL

When business logic compares timestamps (e.g., "is this date in the future?"), move that comparison to SQL instead of doing it in JS with `new Date()`. Use Kysely's `case()` builder or computed columns.

Instead of:
```typescript
const jobs = rawJobs.map((job) => ({
  ...job,
  isScheduled: job.runAt && new Date(job.runAt) > new Date(),
}))
```

Do:
```typescript
.select((eb) =>
  eb
    .case()
    .when(eb.and([
      eb('lockedAt', 'is', null),
      eb('runAt', '>', sql<Date>`now()`),
    ]))
    .then(true)
    .else(false)
    .end()
    .as('isScheduled'),
)
```

This keeps all temporal logic on the database side where the timezone is controlled and `now()` is authoritative.

## CamelCasePlugin reminder

Column names inside `sql` template literals must use **snake_case** (raw SQL bypasses the plugin). The `.as()` alias uses **camelCase** (goes through the plugin):

```typescript
sql<string>`to_char(created_at, 'YYYY-MM-DD')`.as('createdAt')
//                  ^^^^^^^^^^                      ^^^^^^^^^
//                  snake_case (raw SQL)            camelCase (builder)
```
