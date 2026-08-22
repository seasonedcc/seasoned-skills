---
name: testing
description: Write and run tests using Vitest (unit tests) and Playwright (E2E tests). Use when writing tests, fixing tests, running tests, implementing TDD, or when user mentions testing, test-driven development, Vitest, Playwright, unit tests, or E2E tests.
---

# Testing

Comprehensive testing guidelines covering unit testing, E2E testing, test organization, and test-driven development workflows.

## Test Execution Commands

```bash
pnpm run test                       # Run all tests (unit + E2E)
pnpm run test:unit                  # Run all unit tests
pnpm run build && pnpm run test:e2e # Always build before E2E tests
```

**Important**: Always run tests before committing changes.

Arguments for the E2E suite need `--` when they come from the root, because the root
script is a Turborepo task: `pnpm run test:e2e -- tests/landing.spec.ts` forwards the
filter, while the same command without `--` makes Turborepo read `tests/landing.spec.ts`
as a task name and abort. From `apps/web`, call the runner directly and drop the `--`:
`pnpm exec tsx ./tests/run-e2e.ts <args>`. Whichever form you use, read the summary
line — a filter that matches nothing reports "No tests found", and a filter that never
reached Playwright means you just ran something other than what you meant to.

## Test-Driven Development Workflow

When addressing bugs or implementing new features, follow the Red-Green-Refactor cycle:

1. **Red** – Write a test that reproduces the issue or validates the new behavior. The test should fail.
2. **Green** – Implement the minimal code to make the test pass.
3. **Refactor** – Clean up the solution while keeping all tests green.

### Mutation proofs

A green suite proves nothing about a specific test until that test has been seen red for the right reason. When the code under test already exists (a fix being re-verified, a regression test against already-correct code), red-first isn't natural — substitute a mutation proof:

1. Back up the file with `cp file file.bak` — never `git checkout -- <file>` to undo a mutation on a file that also carries uncommitted work, since it discards everything.
2. Revert or neuter exactly the behavior the test pins.
3. Run the specific test and confirm it fails with the expected message — not just "a" failure.
4. Restore the backup and verify it landed (diff or checksum against the original), then confirm green.

False-green smells to check whenever a test passes suspiciously easily: the expected value coincides with the old buggy behavior (the test passes whether the bug is fixed or not); the code path is stubbed above the change under test; an error assertion satisfied by a different error than the one under test firing first; a collection prop every fixture passes empty, leaving the branch that renders it unexercised — an early return above that branch deletes the feature with the whole suite green.

For concurrency tests, never use a timer heuristic (`Promise.race` vs a delay) to prove code blocked — it false-passes under load. Use a deterministic signal, like polling `pg_locks` for a waiter on the exact lock identity.

### Gate reconciliation

Record the exact test and file counts before starting. After the change, compute the expected totals from every `it()`/`describe` block added or removed, then run `test:unit` twice: both runs must match the arithmetic and each other. Any mismatch is a signal — a dropped test file, a duplicated suite, or a flaky test — never noise to shrug off.

## Unit Testing Guidelines

Unit tests use Vitest and test individual functions, components, and business logic.

### Core Principles

- Test the exposed API, its inputs and outputs rather than implementation details
- Focus on application behavior and accessibility
- Avoid testing implementation details like CSS classes or specific HTML tags
- Prefer queries based on roles or other accessibility attributes
- Do not test Zod schemas

### Test Organization

- Group tests with a single `describe` block per subject (e.g., per public function or component)
- Use the name of the subject as the parameter for `describe`
- Avoid catch-all labels like "additional tests"
- Use descriptive names for both `describe` and `it` blocks to make code folding and navigation easier

Example:
```typescript
describe('updatePassword', () => {
  it('fails when passwords are equal', async () => {
    // test implementation
  })

  it('updates the user password', async () => {
    // test implementation
  })
})
```

### Assertion Best Practices

- Prefer expressive matchers such as `toContain`, `toContainEqual`, or `containSubset` instead of manual array scans with `.some`
- When validating failure cases, assert on the specific error (name or class) rather than only checking `result.success === false`

Example:
```typescript
// ✅ Good: Check specific error
expect(result.success).toEqual(false)
expect(isInputError(result.errors[0])).toBe(true)
expect(result.errors[0].message).toBe('Your new password must be different')

// ❌ Bad: Only check success flag
expect(result.success).toBe(false)
```

### Database Testing

- **Never delete records in unit tests**
- Instead, insert records with random identifiers and query by those identifiers
- The database is not cleaned between tests, allowing tests to run in parallel

Example:
```typescript
it('updates the user password', async () => {
  const userId = crypto.randomUUID()
  await db()
    .insertInto('users')
    .values({
      id: userId,
      email: `${userId}@test.ca`,
      encryptedPassword: Buffer.from('current-password')
    })
    .execute()

  // Test with userId
  const result = await updatePassword({ userId, newPassword: 'new-password' })

  expect(result.success).toBe(true)
})
```

### Parallel safety

The suite runs many test files concurrently against one shared database. Three patterns flake under that concurrency:

- Never assert on an unscoped aggregate (`count(*)` without a filter tied to rows this test created) over tables other test files also write to — scope every count to the entity under test.
- Random needles for search/substring tests need real entropy: use `crypto.randomUUID()`, not a few hex characters that can collide with other fixtures. zod's `.uuid()` also validates RFC4122 version/variant bits, so hand-typed ids like `'11111111-1111-1111-1111-111111111111'` fail validation — generate fixture ids.
- Shared lazily-initialized infrastructure (a schema, a singleton) must be bootstrapped once in global setup (`app/test/global-setup.ts`), not on first use per test file — concurrent first uses race the initialization.

Example:
```typescript
it('creates a session for the user', async () => {
  const userId = crypto.randomUUID()
  await db()
    .insertInto('users')
    .values({
      id: userId,
      email: `${userId}@test.example.com`,
      emailAuthHash: crypto.randomBytes(32),
    })
    .execute()

  const session = await createUserSession({
    userId,
    ipAddress: null,
    userAgent: null,
  })

  expect(session.userId).toBe(userId)
})
```

### Env portability

Unit tests run under whatever `apps/web/.env.test` the machine happens to have: CI pins placeholder values in `ci.yml`, while a worktree's copy may carry real endpoints and tokens (setup falls back to copying `.env` when the main checkout has no `apps/web/.env.test`). Two rules keep the suite green everywhere:

- A test that asserts an env-derived value (a request URL, an auth token, a host) must pin the env itself: `vi.stubEnv('SOME_KEY', 'value')` in `beforeEach` and `vi.unstubAllEnvs()` in `afterEach`. `env()` re-parses `process.env` on every call, so stubs take effect immediately. Never write a literal that only matches CI's env values.
- When MSW fails with `[MSW] Cannot bypass a request when using the "error" strategy`, the request matched no registered handler. Compare the request URL MSW logs against the handler pattern and the effective env before suspecting MSW or Node fetch internals — the error reads like an interceptor bug but is almost always a URL mismatch.

### Pipeline tests against a scratch database

Some tests must run a whole pipeline against a *pristine* database rather than the shared one — the dev-seed coverage manifest (`app/db/dev-seed/coverage.test.ts`) and the empty-DB pre-flight (`app/db/dev-seed/preflight.test.ts`) are the examples. The shared `app_test` database is unusable for these: every other test file writes into it so it is never empty (the seed's empty-database pre-flight would abort), and its name does not end in `_development` so the dev-seed guard rejects it.

The pattern (see `app/db/dev-seed/scratch-database.ts`):

- **Provision a throwaway database per run** with `scratchDatabaseName(suffix)`, which derives the name from the ambient `DATABASE_URL`'s database plus a `_development` suffix. Because it is derived from the ambient name, concurrent runs in different worktrees never drop each other's scratch, and the `_development` ending satisfies the dev-seed guard honestly. Create and drop it in `beforeAll`/`afterAll` over a maintenance connection to `/postgres`; the role needs the `CREATEDB` privilege (the helper surfaces a clear error if it is missing).
- **Run the real artifact by shelling out**, not by importing seed modules — the coverage test does `execFile('pnpm', ['run', 'db:migrate:production'])` then `'db:seed:dev'` with an overridden `DATABASE_URL`, so it exercises the canonical ordered pipeline (assert → prod seeds → dev seed) and can never drift from real ordering.
- **Assert on a dedicated `Kysely<DB>`** opened on the scratch URL (`connectToDatabase`), never the shared `db()` singleton, which points at `app_test`.
- **Budget a long timeout** — the pipeline runs every migration plus the full seed, so the pipeline `beforeAll` uses a multi-minute timeout, well above the default.

The coverage manifest has one blind spot worth naming: it fails a *listed* surface whose demo state is missing, but it cannot detect a surface nobody listed. A new in-person exam has four surfaces — the venue capture card, the lab result read, the **customer-facing care interpreted panel**, and the raw observations — and the care interpreted panel is the one most often forgotten, because building the capture card and the lab view feels like finishing the exam. Its absence leaves every gate green (it is unlisted, so nothing fails) yet the customer sees no result. When you add an exam, ship its care interpreted panel and its `care/results/interpreted (<panel>)` manifest entry alongside the others, and confirm the customer view in the browser — the manifest will not remind you.

### React Router Testing

- **Never mock react-router in tests**
- Instead, use `createRoutesStub` to test components that depend on routing

Example:
```typescript
import { createRoutesStub } from 'react-router'

it('renders a basic preview', () => {
  const Stub = createRoutesStub([
    {
      path: '/blog',
      Component: () => <PostPreview post={post} />,
    },
  ])

  render(<Stub initialEntries={['/blog']} />)

  const link = screen.getByRole('link', { name: /hello world/i })
  expect(link.getAttribute('href')).toBe('/blog/hello-world')
})
```

For detailed examples of `createRoutesStub` usage, see [references/examples.md](references/examples.md#react-router-testing).

### Additional Guidelines

- Don't export internal helpers purely for test coverage
- Use the `// @vitest-environment jsdom` comment at the top of UI test files
- Clean up after each test with `afterEach(() => { cleanup() })`

## E2E Testing Guidelines

Playwright drives the real app in a browser: the production build served with
`NODE_ENV=test`, a real worker, real MailDev, a real database. The suite covers every
route in `app/routes.ts` and a coverage gate keeps it that way. Everything below lives
in `apps/web/tests/`.

### How a run works

`pnpm run test:e2e` runs `tests/run-e2e.ts`, which forwards its arguments to
`playwright test` and then runs the coverage gate. A bare spec name is not a
filter — `-- landing` is silently ignored and the whole suite runs; filter with
a path (`tests/landing.spec.ts`) or `--grep`. Playwright's `globalSetup`
(`tests/global-setup.ts`) prepares the world before any spec runs, and `webServer`
boots `test:server`, `test:maildev` and `test:worker` together.

- **The suite has its own database.** `tests/seed/database-url.ts` derives it by
  appending `_e2e` to whatever database `.env.test`'s `DATABASE_URL` names —
  `app_test_e2e`, or `app_wt_<lane>_test_e2e` in a worktree. Unit tests keep the
  plain `_test` database, so the two suites can never trample each other.
  `playwright.config.ts` passes the derived URL to `globalSetup` and to `webServer`,
  where it wins over `.env.test` because dotenv does not override a variable that is
  already set.
- **The seed is layered.** `tests/seed/seed-e2e.ts` creates the database if it is
  missing, migrates it, and — *only when it is empty* — shells out to the real
  `db:seed:dev` pipeline for the base world (venues, staff, protocol CMS, customer
  journeys). Then it runs every flow module in `tests/seed/flows/` and writes
  `tests/.auth/fixtures.json`. The database is never dropped for you and never
  truncated: it is deliberately long-lived and dirty, which is what forces seeds and
  specs to be convergent. To rebuild it, drop it (`dropdb <name>_e2e`) and run again.
- **Sessions are minted, not typed.** Seed flows call `context.mintStorageState(userId,
  persona)`, which commits a real session cookie into
  `tests/.auth/state.<persona>.json`. Specs adopt a persona instead of signing in.
- **Every request is observed.** When `E2E_ROUTE_LOG` is set, a few lines of Express
  middleware in `server/app.ts` append each request path to `tests/.artifacts/route-log`
  (prefetches excluded, so a `prefetch="viewport"` link never fakes coverage). The gate
  reads that log afterwards.
- **Two projects.** `chromium` runs `tests/*.spec.ts` on Desktop Chrome; `mobile` runs
  `tests/*.mobile.spec.ts` on a Pixel 7. Each ignores the other's pattern, so nothing
  runs twice.

`tests/.auth/` and `tests/.artifacts/` are gitignored: fixtures and sessions are build
output, never something to commit or hand-edit.

The environment the app under test reads lives in two places that must agree:
`apps/web/.env.test` locally and the `e2e` job's `env` block in
`.github/workflows/ci.yml`. Anything new a run depends on goes in both, in the same
change — `.env.test` alone is green on your machine and red in CI.

### Running it

```bash
pnpm run build && pnpm run test:e2e                       # the full gated run
pnpm run test:e2e -- tests/landing.spec.ts                # root: arguments need --
cd apps/web && pnpm exec tsx ./tests/run-e2e.ts --project=mobile
cd apps/web && pnpm exec tsx ./tests/run-e2e.ts --workers=2
cd apps/web && pnpm exec tsx ./tests/coverage/gate.ts --report   # re-read the last log
dropdb --if-exists app_test_e2e                          # rebuild the world
```

- **Always build first.** The server serves `build/`, so an unbuilt change is invisible
  and you debug a spec against yesterday's app.
- Locally Playwright reuses a server already listening on the port instead of starting
  its own — another reason a stale build bites.
- The gate **enforces** only on an unfiltered run. Any spec filter, `--project`,
  `--grep` or `--shard` drops it to report-only, because a partial run cannot know which
  routes the rest of the suite would have reached. `--workers` and `--repeat-each` are
  not filters, so they keep the gate enforcing.
- `--repeat-each` copies run **concurrently**. A mutating spec proves itself with
  `--repeat-each=3 --workers=1`.

### The route coverage gate

`tests/coverage/inventory.ts` imports `app/routes.ts` and derives one route id per
`index()`/`route()` entry from its file path (layouts do not count — they are covered
whenever a child is). `tests/coverage/gate.ts` replays the route log through
`matchRoutes` and fails the run on any of five conditions:

1. an uncovered route listed in neither `exclusions.ts` nor `pending.ts`;
2. an exclusion for a route that no longer exists;
3. a pending entry for a route that no longer exists;
4. an excluded or pending route the suite *did* reach — the ratchet: once covered,
   the entry must go;
5. a route listed in both files.

`pending.ts` is empty and must stay that way. A route belongs in `exclusions.ts` only
with a written rationale that cites the unit test owning the behavior end to end or
proves the route is unreachable — "no spec yet" is not a rationale. Adding a route
means adding a spec that reaches it, in the same change.

### Writing a spec

- **One `test()` per file**, and the filename is the behavior sentence in kebab-case:
  `venue-visits-reschedule-a-visit-to-a-free-slot.spec.ts`. Any number of assertions
  inside; the limit is on `test()` calls.
- **Never touch the database and never read `process.env`.** Everything a spec needs
  comes from `fixtures()` in `tests/helpers.ts` (typed against `fixtures.json`) and
  from Playwright's `baseURL`. The MailDev port is the one sanctioned environment
  value, and it arrives through fixtures too.
- **Pick a persona:** `test.use({ storageState: storageStatePath('e2e-care-results') })`.
  Signed out is `test.use({ storageState: { cookies: [], origins: [] } })`. A second
  actor in the same spec comes from `browser.newContext({ storageState })`. Sign in
  through the UI only where authentication *is* the subject — the magic-link journey in
  `tests/sign-up.ts`, which polls MailDev's web API for the real email.
- **Select the way a user perceives the page**: `getByRole`, `getByLabel`,
  `getByPlaceholder` with the real pt-BR copy. No test ids. Absence is
  `await expect(locator).toHaveCount(0)`, never a negated visibility check.
- **Assert display strings that came from fixtures**, so the seed and the spec cannot
  drift apart. Importing an app `.common.ts` module for copy or constants is encouraged
  (`DASS21_QUESTIONS`, `VISIT_STATE_LABELS`); importing a `.server.ts` module is not —
  it would drag the database and env into the test process.
- **Prove persistence by round trip**: mutate, re-navigate, assert the durable state.
- **Do not assert flash toasts.** On prefetch-heavy shells a viewport prefetch consumes
  the one-shot `_app_flash` cookie before the page you are watching reads it. Assert
  `toHaveURL` plus the re-navigated state instead.
- **Never assert an exact count or completeness of a shared list.** Sibling flows and
  future seeds add rows to the same venue, protocol or customer list. Scope to the row
  you created and assert on that.
- **A paginated list hides the rows a growing seed pushed off page one.** Lab lists
  paginate at ten, and every new seed flow adds rows to them, so a spec that opens a list
  to find its own row is one seeded row from red. Ask for a page wide enough to hold
  everything — `?per-page=100` (the loader camel-cases search params, so `perPage` is the
  same parameter) — and identify the row by something intrinsic to the record,
  `filter({ has: page.locator('[href="/lab/results/<id>"]') })`, rather than by text plus
  `.first()`, which quietly matches a sibling flow's row instead
  (`tests/lab-result-details-lists-observations-and-duplicates-the-result.spec.ts`).
- `filter({ has: ... })` re-roots the inner locator at each candidate, so a locator that
  reads correctly can match nothing once it is nested in a helper. Build the inner
  locator relative to the candidate, and check the count you expect.
- Renaming or removing user-facing copy means grepping all of `tests/` for the old
  string. A lane's own subset run will not catch cross-file drift; CI will.

### Retry safety is the bar

CI retries three times. A spec is correct only if it passes when re-run against the
state an attempt that **died at any line** left behind — not merely when re-run after a
clean pass. That is why cleanup-at-the-end is never the answer: the attempt that
mattered never reached the cleanup.

Two patterns satisfy the bar:

- **A convergent prologue**: start by driving the world into the state the spec needs
  (delete the leftover copy, close the open visit, clear the filter) instead of assuming
  a pristine one.
- **Attempt-unique identity**: name the thing you create per attempt, or draw from a
  seeded pool with `attemptSlot()` in `tests/helpers.ts`, which indexes by
  `repeatEachIndex` and `retry`. A pool must hold at least as many entries as CI can
  attempt (1 + 3 retries = 4 per repeat), or a spec that mutates then fails exhausts it
  and the next attempt fails for the wrong reason.

Making an operation one-way — an answer that cannot be rewritten, a record that submits
once — retroactively breaks every spec that performs it, however well written: the
attempt that died leaves a resource no later attempt can drive, so all three retries fail
for the wrong reason. A change that removes repeatability from a flow carries the duty to
move every spec that drives it onto a per-attempt pool in the same change.

**Proving it**: `--repeat-each=3` only proves the *happy path* is repeatable — it
cleans up after itself every time. To prove death-safety, simulate the death inside a
single Playwright invocation: put a `SIMULATED-DEATH` test above the real one that
performs the mutation and stops, or abort mid-spec on the first attempt
(`expect(test.info().retry).not.toBe(0)`), then run with `--workers=1` and watch the
real spec pass on the retry. Pair it with a negative control — the same run without the
convergent prologue must fail — or you have proven nothing.

### Racy by design: what to wait for

- **Hydration.** Never navigate or click immediately after `page.goto()` on a route with
  a hydrating `clientLoader`: the server HTML is interactive before the client router
  takes over, and the first click is swallowed. Wait for
  `window.__reactRouterDataRouter.state.initialized === true` first — `openVisitsBoard`
  in `tests/venue-visits.ts` is the pattern. Reproduce a CI-only race locally with CDP
  `Emulation.setCPUThrottlingRate` at 8–20×. A failure that is intermittent across runs
  but deterministic within an attempt is a machine-speed race, not bad state.
- **Debounced inputs.** A debounced search field navigates only after its delay, and
  `fill()` returns immediately — assertions written right after it can pass against the
  previous DOM (a false green that survives deleting the feature), and the next `fill()`
  cancels the still-pending submit outright. After each fill, assert the URL carries that
  step's term, percent-encoded — `await expect(page).toHaveURL(new RegExp('q=' +
  encodeURIComponent(term)))` — before asserting content;
  `tests/lab-services-searches-the-catalog.spec.ts` is the pattern.
- **Eventual consistency.** Pages built on `cachedClientLoader` plus polling are
  eventually consistent by design; the first paint after a mutation legitimately shows
  stale data. Use `reloadUntil(page, assertion)` from `tests/helpers.ts`, which reloads
  until the server agrees — and thereby also proves persistence. This is the opposite of
  flake-masking: wrapping a flow that *should* be synchronous in `toPass` to make it
  green is the anti-pattern.
- **Prefer waiting on the action itself.** `waitForAction(page, '/path', interact)` waits
  for the POST the click fires. A reload-until loop around a synchronous flow can hide a
  real product race for months.

### Time is not yours to assume

- The seeded world is anchored to **one rolling date computed in SQL**
  (`context.dates`), and display strings are formatted in SQL and exported through
  fixtures. No `Date.now()` in seeds, no absolute dates in specs.
- `context.dates` is a **UTC** date. Venue and lab days run in `America/Sao_Paulo`.
  Compute any day boundary in SQL against the venue's own timezone.
- **Fresh-database class of failure.** CI builds the E2E database from scratch, so a
  seeded row backdated relative to `now()` can predate a configuration row created
  seconds earlier, and "the setting active at time X" correctly resolves to nothing. The
  fix is to rewrite the seeded history onto a one-second ladder ending yesterday
  (`tests/seed/flows/venuePanel.ts`), never a wait and never a weakened assertion.
  Reproduce by dropping the `_e2e` database and running immediately.
- **Wall-clock independence.** A predicate like "a slot still available today" goes empty
  once a whole visit no longer fits before closing time — specs that pass all afternoon
  fail deterministically after 22:00. Derive the seeded window from the data it must
  serve: close the venue one slot plus the longest offered visit past midnight, computed
  in SQL from the venue's own protocols, and fail loudly if there is none. One residual
  hazard is known and unclosed from test files: the venue day rolls over at São Paulo
  midnight (03:00 UTC) while the seeded visit timelines reach about a hundred minutes
  into the past. Between midnight and roughly 01:40 local those events belong to
  *yesterday*, so every "today" list — the operations panel's "Concluídos hoje", for one
  — is correctly empty and the specs that read them fail. A local run in that window is
  not a regression; wait it out or run something else.

### Seeding a new journey

Add `tests/seed/flows/<flow>.ts` exporting `namespaces` (the identifier prefixes it
reserves) and `seed(context)` returning its fixtures. The orchestrator merges the return
value under the module's stem, so `flows/care.ts` becomes `fixtures().care`.

- **Converge, never assume.** Find-or-create on a stable natural key, and *update* the
  found row into the state you want — a `doNothing()` conflict clause does not converge
  a row a spec mutated on a previous run.
- **Go through real business functions** with real contexts for anything with domain
  invariants; raw Kysely writes are for skeleton rows (users, venues, roles) only.
- **Own your namespace.** Guards abort the seed on a fixture-key collision, on two flows
  reserving overlapping prefixes, and on a flow exporting a value that lands inside
  another flow's namespace. They police *seed fixtures* only — a spec can still squat a
  namespace at runtime (the magic-link spec creates users under `e2e-auth`), so keep
  that discipline by hand.
- **Filter what you gather.** A seed query that bundles "all protocols" sweeps in sibling
  flows' namespaced rows, and the next convergent pass exports a foreign name straight
  into the trespass guard. Any bundle-everything query filters
  `where name not like '%e2e-%'` — a *contains* match, not a prefix one — and sheds rows
  it absorbed before the filter existed.
- **Dedicate entities to mutating scenarios.** Never let a spec that writes share the
  dev-seed personas with the specs that read.

### LLM-backed jobs

There is no LLM stub. The suite's real worker executes real jobs, and a job that calls
`generateText` reaches the real provider SDKs — which cannot work in CI, where every
provider key is the placeholder `test-key`. Two established patterns cover every case:

- **Fabricate the output in the seed.** Write the rows the job *would* have written
  (an analysis run, an extraction row with its reading) exactly as
  `dev-seed/results.ts` fabricates analysis steps, and let the spec assert the UI over
  them. This is how success paths are exercised.
- **Drive the enqueue, expect the failure path.** A spec may exercise the real
  upload-to-job flow, but the job's provider call will fail in every environment (bogus
  keys in CI; locally, test uploads land in `LocalFileStorage` while job downloads go
  through the real S3 client). That failure is deterministic today — and only today:
  if storage or keys are ever unified, an LLM stub (the fake-Stripe endpoint pattern)
  must ship before any such spec, or it goes non-deterministic.

Never assert exact model output anywhere, and never write a spec whose premise
requires a real model to behave a particular way.

### The mobile project

`*.mobile.spec.ts` files run on a Pixel 7. Write one when a journey is genuinely
different on a phone — a collapsed sidebar, a bottom dock, an icon-only control, a long
article — not to duplicate desktop coverage. Assert what proves the layout works:
navigation is reachable, content is readable, primary actions are tappable
(`click({ trial: true })` runs Playwright's full actionability check without firing the
action), and `expectFitsTheViewport(page)` from `tests/helpers.ts` catches a page that
scrolls sideways. Never assert pixel values. The native shell itself belongs to Maestro
(`apps/mobile/e2e/`); this project covers the mobile *web* layout the shell renders.

### When CI fails and your machine does not

- Failure artifacts come from `apps/web/test-results/` (screenshots and first-retry
  traces) and `apps/web/tests/.artifacts/` (the route log). There is no HTML report:
  the suite runs the `list` reporter.
- A pull request showing **"No checks reported"** is not a CI outage — it conflicts with
  `main`, GitHub cannot build the merge commit, and it silently skips the workflows.
  Rebase.
- **Measure before theorizing.** `gh run download <runId>` fetches the failing retries'
  Playwright traces; their `.network` entries carry per-request timings. Compare them
  with a locally traced run of the same spec (`--trace on`): a data request that costs
  ~100ms locally routinely costs 2–4s on the two-core CI runner, so a post-action
  assertion bounded by the default 5s expect window sits on a cliff whenever a page's
  round trips stack up. The venue panel is the suite's heaviest page and its specs
  assert through a widened `expect.configure({ timeout: 15_000 })` for exactly this
  reason — reuse that pattern for any new spec on a comparably heavy page.
- **Two cheap experiments before blaming your diff.** Rerun the failed job on the
  unchanged commit (`gh run rerun <runId> --failed`): a pass proves there is no
  deterministic regression in the diff. And read the failing spec's duration off recent
  *green* main runs (`gh run view <id> --log | grep <spec>`): a spec whose green-run
  duration has been climbing toward its budget (say 5.5s → 9.8s → 28.6s against 30s)
  was already on a cliff, and any branch's run merely tips it. When that trend exists,
  the fix is the page's cost — count statements from the Postgres log and remove the
  duplicated work — not a bigger budget; halving the venue panel's round trips cut the
  whole suite from ~11 to ~6.5 minutes.
- **When the question is state rather than time**, get ground truth with a throwaway
  diagnostic branch: a draft PR whose only addition is a spec named to sort just before
  the failing family, dumping the relevant tables with raw SQL `console.log`s. Read the
  dump in the CI log, close the PR unmerged, delete the branch.
- A failed first attempt can leave the seeded day half-mutated, so its retries and every
  later spec in the family inherit corrupted state. Diagnose the first failure in file
  order — the loudest downstream failure is usually cascade, not cause.

For a worked spec and a worked seed flow, see
[references/examples.md](references/examples.md#e2e-testing).

## Reference Examples

For concrete code examples demonstrating these patterns, see [references/examples.md](references/examples.md).
