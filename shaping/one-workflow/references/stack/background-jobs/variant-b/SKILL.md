---
name: background-jobs
description: Create and manage background jobs with graphile-worker using makeJob and makeCronJob. Use when adding new background jobs, cron jobs, fan-out patterns, enqueuing work, or working with the worker infrastructure.
---

# Background Jobs

Background jobs use graphile-worker via `makeJob` and `makeCronJob` from `~/framework/worker.server`. The app registers its jobs in `app/business/jobs.server.ts` and runs them in a separate process (`run-worker.ts`).

graphile-worker mutates its own `graphile_worker` schema internally — that is fine; it is third-party-owned. Job handlers themselves write to the application schema, so they follow the append-only doctrine: INSERT-only, status derived from event rows (load the database-design skill).

## Framework API

### `makeJob(jobName, run, options?)` — On-Demand Job

Creates a job that is enqueued explicitly from business logic.

```typescript
import { makeJob } from '~/framework/worker.server'

const processFile = makeJob(
  'processFile',
  async ({ fileId }: { fileId: string }) => {
    // job logic
  },
  { priority: 5 },
)
```

Returns `{ enqueue, run, jobName }`:
- `enqueue(payload)` — adds the job to the queue (uses the priority from the job definition)
- `run(payload, helpers)` — the handler function (also used directly in tests)

The optional `options` parameter accepts `{ priority?: number }`. Lower number = higher priority (runs first). Default is 0 (from graphile-worker).

### `makeCronJob(jobName, cronMatch, run, options?)` — Scheduled Job

Creates a job that runs on a cron schedule.

```typescript
import { makeCronJob } from '~/framework/worker.server'

const cleanupExpired = makeCronJob(
  'cleanupExpired',
  '0 * * * *',  // every hour
  async () => {
    // job logic
  },
  { priority: 13 },
)
```

Returns everything from `makeJob` plus `cronItem` with the schedule. The `options` parameter works the same as `makeJob` — priority is applied both to the cron item and to any manual enqueue calls.

## Naming Convention

Job names must start with a verb. Both the variable name and the job name string (first argument to `makeJob`/`makeCronJob`) must match.

```typescript
// Good: verb-first names
const sendAuthEmail = makeJob('sendAuthEmail', ...)
const processPlotSummaryIntake = makeJob('processPlotSummaryIntake', ...)
const pollPlotSummaryIntake = makeCronJob('pollPlotSummaryIntake', ...)

// Bad: noun-first names
const plotSummaryIntakeProcess = makeJob('plotSummaryIntakeProcess', ...)
const plotSummaryIntakePoll = makeCronJob('plotSummaryIntakePoll', ...)
```

## Job Registration

Every job (both `makeJob` and `makeCronJob`) must be added to the `jobs` array in `app/business/jobs.server.ts`:

```typescript
import { sendAuthEmail } from './auth.server'
import { myNewJob, myNewCronJob } from './my-feature.server'

const jobs = [sendAuthEmail, myNewJob, myNewCronJob]

export { jobs }
```

The worker runner uses this array to build both the task list and cron schedule.

## Patterns

### On-Demand Job

For jobs triggered by business logic (e.g., sending emails after an action).

Define the job in a business file and call `.enqueue()` from other business functions:

```typescript
const sendNotification = makeJob(
  'sendNotification',
  async ({ userId, message }: { userId: string; message: string }) => {
    const user = await db()
      .selectFrom('users')
      .select('email')
      .where('id', '=', userId)
      .executeTakeFirst()

    if (!user) return

    // send email...
  },
)

// Called from another function:
await sendNotification.enqueue({ userId: user.id, message: 'Welcome!' })
```

### Fan-Out Pattern

For processing multiple items in parallel. A cron job discovers work and enqueues individual child jobs.

**Parent cron job** — discovers items, creates records in a transaction, then enqueues after commit:

```typescript
const enqueuePendingItems = makeCronJob(
  'enqueuePendingItems',
  '*/5 * * * *',
  async () => {
    const pending = await db()
      .selectFrom('items')
      .select('id')
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('records')
              .select('id')
              .whereRef('records.itemId', '=', 'items.id'),
          ),
        ),
      )
      .execute()

    await Promise.all(
      pending.map(async (item) => {
        const intake = await db()
          .transaction()
          .execute(async (trx) => {
            const record = await trx
              .insertInto('records')
              .values({ itemId: item.id })
              .returning('id')
              .executeTakeFirstOrThrow()

            return await trx
              .insertInto('intakes')
              .values({ recordId: record.id })
              .returning('id')
              .executeTakeFirstOrThrow()
          })

        await processItem.enqueue({ itemId: item.id, intakeId: intake.id })
      }),
    )
  },
)
```

**Child job** — processes a single item:

```typescript
const processItem = makeJob(
  'processItem',
  async ({ itemId, intakeId }: { itemId: string; intakeId: string }) => {
    // Idempotency check: a success event means the work already happened
    const existing = await db()
      .selectFrom('successes')
      .select('id')
      .where('intakeId', '=', intakeId)
      .executeTakeFirst()

    if (existing) return

    // process...
  },
)
```

Both jobs must be registered in `jobs.server.ts`.

### Error Tracking

Track which step failed by using a mutable `step` variable. Wrap the success path in a transaction (see Transactions section below) and record failures outside the transaction so they always persist. **Always re-throw the error** after recording it — graphile-worker only retries jobs that throw, so swallowing errors silently marks the job as succeeded:

```typescript
const processFile = makeJob(
  'processFile',
  async ({ fileId, intakeId }: { fileId: string; intakeId: string }) => {
    let step = 'download'
    try {
      await db()
        .transaction()
        .execute(async (trx) => {
          const existing = await trx
            .selectFrom('successes')
            .select('id')
            .where('intakeId', '=', intakeId)
            .executeTakeFirst()

          if (existing) return

          const data = await downloadFile(fileId)

          step = 'upload'
          await uploadToS3(key, data)

          await trx
            .insertInto('successes')
            .values({ intakeId })
            .execute()
        })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      await db()
        .insertInto('failures')
        .values({ intakeId, step, errorMessage })
        .execute()

      throw error
    }
  },
)
```

## Transactions

When a job runs multiple database queries, wrap them in a transaction for atomicity:

```typescript
await db()
  .transaction()
  .execute(async (trx) => {
    // Use trx instead of db() for all queries inside the callback
    const record = await trx.selectFrom('items').select('id').where('id', '=', itemId).executeTakeFirstOrThrow()
    await trx.insertInto('itemCompletions').values({ itemId: record.id }).execute()
  })
```

**Rules:**
- Use `trx` (not `db()`) for all queries inside the transaction callback
- Transactions auto-rollback on exceptions — no manual rollback needed
- Keep failure recording OUTSIDE the transaction so it persists after rollback (see Error Tracking pattern above)
- When creating records then enqueuing a child job, return data from the transaction and enqueue AFTER it commits — this prevents enqueuing jobs that reference uncommitted records
- Single-query jobs (e.g. one SELECT + an email side effect) do not need transactions

## Payload Design

- Keep payloads minimal — only IDs and essential data
- Do not include data that is only useful for debugging
- Use inline typed object parameters (no separate type declaration needed)

```typescript
// Good: minimal payload with only what's needed
const processItem = makeJob(
  'processItem',
  async ({ itemId, intakeId }: { itemId: string; intakeId: string }) => {
    // ...
  },
)

// Bad: including extra data not used by the job
const processItem = makeJob(
  'processItem',
  async ({ itemId, intakeId, originalName, createdBy }: { ... }) => {
    // originalName and createdBy are never used
  },
)
```

## Idempotency

Jobs may be retried by graphile-worker. Always check if the work has already been done:

```typescript
const processItem = makeJob(
  'processItem',
  async ({ intakeId }: { intakeId: string }) => {
    const existing = await db()
      .selectFrom('successes')
      .select('id')
      .where('intakeId', '=', intakeId)
      .executeTakeFirst()

    if (existing) return

    // proceed with processing...
  },
)
```

For fan-out patterns, the parent cron job should also prevent duplicate enqueuing — typically by checking a database table or using unique constraints.

## Testing

### Testing a Job's Run Function

Call `.run()` directly with the payload and an empty `JobHelpers`:

```typescript
import type { JobHelpers } from 'graphile-worker'

it('processes the item', async () => {
  await myJob.run(
    { itemId: 'test-id' },
    {} as JobHelpers,
  )

  // assert results...
})
```

### Testing That a Function Enqueues a Job

Spy on `.enqueue()` and mock its return value:

```typescript
it('enqueues the job', async () => {
  const spy = vi.spyOn(myJob, 'enqueue').mockResolvedValue()

  await functionThatEnqueues()

  expect(spy).toHaveBeenCalledOnce()
  expect(spy).toHaveBeenCalledWith({ itemId: 'expected-id' })
})
```

### Testing Error Re-throw

Assert that errors are both recorded to the failure table and re-thrown using `rejects.toThrow()`:

```typescript
it('records failure and re-throws when download fails', async () => {
  const { intakeId } = await createIntakeRecords(fileId, filename)
  mockedDownloadFile.mockRejectedValue(new Error('GDrive download failed'))

  await expect(
    processItem.run(
      { fileId, intakeId },
      {} as JobHelpers,
    ),
  ).rejects.toThrow('GDrive download failed')

  const failure = await db()
    .selectFrom('failures')
    .selectAll()
    .where('intakeId', '=', intakeId)
    .executeTakeFirstOrThrow()

  expect(failure.step).toBe('download')
  expect(failure.errorMessage).toBe('GDrive download failed')
})
```

### Testing a Fan-Out Cron Job

Spy on the child job's `.enqueue()` in `beforeEach`, then call the parent function:

```typescript
describe('pollAndEnqueue', () => {
  let enqueueSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    enqueueSpy = vi
      .spyOn(childJob, 'enqueue')
      .mockResolvedValue()
  })

  it('enqueues for each pending item', async () => {
    // set up test data...
    await pollFunction()

    expect(enqueueSpy).toHaveBeenCalledTimes(expectedCount)
  })
})
```

## Worker Configuration

The worker runs as a separate process via `run-worker.ts` (at the repo root):
- **Concurrency**: 5 parallel workers
- **Poll interval**: 1000ms
- **Cron schedules**: Parsed automatically from registered `CronJob` entries

## References

- Framework infrastructure: `app/framework/worker.server.ts`
- Job registration: `app/business/jobs.server.ts`
- Worker entry point: `run-worker.ts`
- On-demand job example: `app/business/auth.server.tsx` (`sendAuthEmail`)
