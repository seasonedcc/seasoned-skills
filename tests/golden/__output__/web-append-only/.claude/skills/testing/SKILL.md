---
name: testing
description: Write, run, and debug tests across the project's unit and end-to-end suites. Covers test-driven development and mutation proofs, gate reconciliation, parallel-safe unit tests, E2E seeding and retry safety, coverage discipline, and diagnosing CI-only failures and flakes. Use when writing tests, fixing or diagnosing failing or flaky tests, running test suites, seeding E2E data, or when the user mentions testing, test-driven development, unit tests, E2E tests, or mutation proofs.
---

# Testing

Comprehensive testing guidelines covering unit testing, E2E testing, test organization, and test-driven development workflows.

## Running tests

```bash
pnpm run test:unit   # every unit test
pnpm run build && pnpm run test:e2e   # the specs related to a change, chosen by blast radius
```

The full end-to-end suite is continuous integration's job, never a local step. Locally, run the specs related to the change — related by the change's blast radius, not literally the specs of the files touched — and read the full-suite verdict fresh from the CI run on the draft pull request. A change to the seed or to the E2E runner touches every spec, so there the related set is the full suite.

Whatever filter you run, read the runner's summary line — a filter that matches nothing reports "No tests found", and a filter that never reached the test runner means you just ran something other than what you meant to.

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

Record the exact test and file counts before starting. After the change, compute the expected totals from every `it()`/`describe` block added or removed, then run the unit gate twice: both runs must match the arithmetic and each other. Any mismatch is a signal — a dropped test file, a duplicated suite, or a flaky test — never noise to shrug off.

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
- An absence assertion pinned to an exact accessible name is a silent false-pass when the element's real name is a concatenation of child spans — `queryByRole('link', { name: 'Connect account' })` can match nothing whether or not the element is present. For absence, match on a regex or unique text, and mutation-prove it by rendering the element and watching the assertion fail.

Example:
```typescript
// ✅ Good: Check specific error
expect(result.success).toEqual(false)
expect(isInputError(result.errors[0])).toBe(true)
expect(result.errors[0].message).toBe('Your new password must be different')

// ❌ Bad: Only check success flag
expect(result.success).toBe(false)
```

### Ground-truth fixtures

When a fixture transcribes an external source of truth — a customer's real workbook, a regulator's table — three rules keep it trustworthy:

- Every value names the source it came from (workbook, sheet, and cell) in a **data field**, never a comment, so the citation travels with the value and a reviewer can re-open the source.
- A disagreement between the fixture and the product is a product finding. Never edit the fixture to make an assertion pass — that converts the only independent evidence into a restatement of the code.
- Where the product deliberately departs from the source, assert the departure as the formula that generates it, never as the constant it happens to equal today.

### Database Testing

- **Never delete or update records in unit tests — the schema is append-only, and tests follow the same doctrine**
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
      email: `${userId}@test.example.com`,
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
- Shared lazily-initialized infrastructure (a schema, a singleton) must be bootstrapped once in the suite's global setup, not on first use per test file — concurrent first uses race the initialization.

A run that reports every test passing yet exits 1 with Vitest's "Unhandled Errors" block ("caught after test environment was torn down") has work outliving a test file — a mounted React root with a queued render, a timer such as msw's `delay('infinite')` (a ~24-day `setTimeout`; stall on the request's abort signal instead), an unawaited insert. Fix the abandonment at its source; never suppress or ignore the error. These flakes live in a narrow scheduling window — plain full-suite runs can go many runs without a hit — so reproduce with oversubscribed workers (`--maxWorkers` well above the core count) and prove the fix by instrumenting what is still pending at end-of-file, not by clean runs alone.

When pinning not-found behavior against a custom error class, check what the class actually sets: a class that never assigns `.name` still reports `'Error'` there, so assert on its `.message` or with `instanceof`, never on `.name`.

A hand-built business-function context carries real ids from its fixtures — the organization id from the organization the test created, never an `''` placeholder. Queries compare context ids against uuid columns, so a placeholder cast-errors at runtime, and one that passes today fails the moment the function under test gains another scoped join. Placeholder text is only safe in fields no query consumes, like a display name.

### Env portability

Unit tests run under whatever `.env.test` the machine happens to have: CI pins placeholder values in the workflow file, while a worktree's copy may carry real endpoints and tokens. Two rules keep the suite green everywhere:

- A test that asserts an env-derived value (a request URL, an auth token, a host) must pin the env itself: `vi.stubEnv('SOME_KEY', 'value')` in `beforeEach` and `vi.unstubAllEnvs()` in `afterEach`. `env()` re-parses `process.env` on every call, so stubs take effect immediately. Never write a literal that only matches CI's env values.
- When MSW fails with `[MSW] Cannot bypass a request when using the "error" strategy`, the request matched no registered handler. Compare the request URL MSW logs against the handler pattern and the effective env before suspecting MSW or Node fetch internals — the error reads like an interceptor bug but is almost always a URL mismatch.

### Pipeline tests against a scratch database

Some tests must run a whole pipeline against a *pristine* database rather than the shared one — a seed-coverage manifest test and an empty-database pre-flight are the canonical shapes. The shared unit-test database is unusable for these: every other test file writes into it so it is never empty (an empty-database pre-flight would abort), and guards protecting development-only pipelines rightly reject its name.

The pattern:

- **Provision a throwaway database per run**, deriving its name from the ambient `DATABASE_URL`'s database plus the suffix the guarded pipeline expects. Because it is derived from the ambient name, concurrent runs in different worktrees never drop each other's scratch, and the suffix satisfies the guard honestly. Create and drop it in `beforeAll`/`afterAll` over a maintenance connection to `/postgres`; the role needs the `CREATEDB` privilege (surface a clear error if it is missing).
- **Run the real artifact by shelling out**, not by importing its modules — `execFile` the canonical migrate and seed commands with an overridden `DATABASE_URL`, so the test exercises the real ordered pipeline and can never drift from real ordering.
- **Assert on a dedicated `Kysely<DB>`** opened on the scratch URL, never the shared `db()` singleton, which points at the shared test database.
- **Budget a long timeout** — the pipeline runs every migration plus the full seed, so the pipeline `beforeAll` uses a multi-minute timeout, well above the default.

A coverage manifest has one structural blind spot worth naming: it fails a *listed* surface whose expected state is missing, but it cannot detect a surface nobody listed — an unlisted surface leaves every gate green while the user sees nothing. When a change adds a family of surfaces, ship every surface's seed state and manifest entry alongside the others, and confirm the user-facing one in the browser — the manifest will not remind you.

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
- Clean up after each test with `afterEach(() => { cleanup() })` — and know its limit: `cleanup()` unmounts only roots Testing Library's own `render()` created. A test that calls `hydrateRoot`/`createRoot` itself must keep the returned root and unmount it inside `act()` in its own `afterEach` before removing the container; a root left mounted keeps a React render queued that can land after jsdom is torn down, failing the whole run after every test passed.
- Component-test local types and factories don't import the loader's types, so a new loader field never fails typecheck there. When a loader payload gains a field or a render guard keys off one, extend those local types and factories in the same change — otherwise the new branch ships with zero coverage. When user-visible copy or CTAs change, also grep all of `tests/` — the E2E specs and the seed flows both carry product copy verbatim — for stale assertions.

## E2E Testing Guidelines

E2E tests use Playwright and drive complete user journeys through the built app in a
real browser: the production build served with `NODE_ENV=test`, a real worker, a real
mail catcher, a real database. The suite covers every route in `app/routes.ts` and a
coverage gate keeps it that way.

Always build first. The suite runs against the built bundle, and the route observer the
coverage gate reads lives inside that bundle — an unbuilt change is invisible, and you
debug a spec against yesterday's app.

### One product per Playwright worker

A Playwright worker here is a whole product rather than a browser. The config starts one
shared process only — the mail catcher, which every worker shares, because specs read
their mail by recipient address. Everything else belongs to the worker: the app-stack
fixture in `tests/harness.ts` spawns that worker's own app server and its own job worker
against its own database, on the lane's `PORT` plus the worker's index, and hands the
spec the `baseURL` that reaches it.

**A spec imports `test` and `expect` from `./harness`**, never from `@playwright/test`
— only types come from there. That fixture is the whole of what supplies `baseURL`,
since the config sets none, so a spec taking Playwright's own `test` fails on its first
relative `page.goto`.

A file is the unit of parallelism: `fullyParallel` is false, so the tests inside a file
run in order in one worker, and therefore against one database, and can build on each
other's state.

The harness is the only place that sets `E2E_ROUTE_LOG`, one log file per worker. It
also moves every address in the environment that points the product back at itself —
the provider stubs it calls are its own routes — from the lane's port to the worker's.
The move is a textual swap of `localhost:<lane port>`, so a new self-referencing URL is
written in exactly that shape; spell it any other way and every worker's stub traffic
lands in the first worker's database.

A stray process holding a worker's port fails the run by name after a timeout rather
than being adopted. Stop a dev server left over before a run.

Both of a worker's processes append to `tests/.artifacts/stack-<index>.log`, in the
order things happened. React Router says nothing about a failed request while it serves
in test mode, so that file is the only account a run leaves of a 500; CI uploads it
beside the Playwright report.

The worker count is a project fact, bounded by real capacity rather than doctrine: each
worker's stack holds its own database-connection pool, and enough workers exhaust what
the machine's Postgres offers — the run dies with `sorry, too many clients already`
surfacing as an unexplained 500. A contention-shaped failure — connection exhaustion,
timeouts under load — is re-run alone before anyone treats it as a defect.

`tests/.auth/` and `tests/.artifacts/` are gitignored: fixtures, sessions, and logs are
build output, never something to commit or hand-edit.

One Playwright detail to know when proving repeatability: `--repeat-each` copies of a
spec run **concurrently**. A mutating spec proves itself with
`--repeat-each=3 --workers=1`.

### Database ownership

The Playwright suite owns the database named by `.env.test` outright. The unit suite
derives a database of its own from that same connection string in its global setup and
never touches the E2E one, so the two suites can never trample each other.

Global setup seeds that canonical database once — the seed creates it if missing,
migrates it, and converges every flow onto it — and then clones it per worker as
`<name>_w<index>`. It drops the clones the last run left before making this run's, and
Postgres copies a template only while nothing is connected to it, so connections to the
canonical database are closed first and the clones are made one at a time.

The canonical database is deliberately long-lived and never reset: a database that
survives is what forces the seed to be convergent. To start it over, drop it by hand and
rerun the suite.

No spec touches it. A spec runs against its worker's clone, which is dropped and re-made
from the seed at the start of the next run, so nothing a spec writes outlives the run
that wrote it.

### The route coverage gate

Coverage is measured from real traffic, never asserted.

- **Observation** — the server appends each request path to the file named by
  `E2E_ROUTE_LOG`, one log per worker. The middleware only exists when that variable is
  set, so no other run pays for it. It skips requests carrying a prefetch `Sec-Purpose`
  or `Purpose` header: a link the browser warmed on its own must not count as a visit.
- **Inventory** — the gate derives one route id per entry in `app/routes.ts` from that
  entry's route file. Pathless layouts leave the denominator (a layout is reached
  whenever a child is), and two entries backed by one file throw, since ids are
  synthesized from the filename.
- **Replay** — the gate feeds the log through React Router's own `matchRoutes`, so the
  URL-to-route-id mapping is the app's. What the run reached is the union of the
  per-worker logs, and a run that left no log at all throws rather than reporting an
  empty picture. A client navigation asks for `<pathname>.data`, and `/_root.data` at
  the root, so the gate resolves both back to the visitor's path first. React Router's
  `/__manifest` endpoint is skipped — the catch-all route would otherwise count it as a
  visit to the not-found page.

Global setup deletes the previous run's logs, so the gate always reads exactly one run's
traffic.

The gate fails five ways, each naming its fix:

1. An uncovered route listed in neither register.
2. An excused-surfaces entry for a route that no longer exists.
3. A coverage-register entry for a route that no longer exists.
4. A listed route the suite *did* reach — the ratchet: once covered, the entry comes
   out in the same change.
5. A route listed in both registers.

It enforces only on an unfiltered run. A spec path, `--grep`, `-g`, `--grep-invert`,
`--project`, `--shard`, `--last-failed`, or `--only-changed` drops it to reporting,
because a partial run cannot know what the rest of the suite would have reached.
`--workers`, `--repeat-each`, and `--reporter` change how the suite runs, not which
specs run, and keep it enforcing, in both the `--flag=value` and `--flag value` forms.

The coverage register — `tests/coverage/pending.ts` — carries the routes no spec reaches yet
and only ever shrinks. Adding a route means adding the spec that reaches it in the same
change; when the gate is installed into a project that already has unreached routes, the
install seeds the register with them, and once empty it is held empty forever. The
excused-surfaces list — `tests/coverage/excused.ts` — takes a route only with a written
rationale citing the unit test that owns the behavior end to end, or proof the route is
unreachable from the product. "No spec yet" is never a rationale — that is the coverage
register.

Rehoming a surface's writes mints new action routes — the route is new even though the
behavior it carries is old, and nothing reaches it until a spec drives that write on its
new home. A change that moves writes moves the specs that drive them, in the same
change. Filtered local runs drop the gate to reporting, so only the unfiltered CI run
says whether a rehomed route is covered.

### The seed

The seed is a thin orchestrator over one module per journey in `tests/seed/flows/`. The
seed context holds the date anchor, session minting, and the prerequisite lookups;
shared primitives live beside the flows.

A flow module exports three things:

- `namespaces` — the identifier prefixes it reserves (names, codes, note strings).
- `companies` — the organization and company names it owns.
- `seed(context)` — returns the flow's fixtures.

The orchestrator discovers the flow files in filename order and merges each flow's
return value under its filename stem, so **filename order is dependency order** and
fixtures are nested: `fixtures.receiving.approvedPoId`. The base flow sorts first and
seeds the account and company every later flow leans on; a flow that creates an
organization seeds its own administrator role rather than assuming another flow did.
The fixture keys the orchestrator owns are listed in one constant so no flow can claim
them.

Four guards fail the seed loudly, and each catches a distinct way flows collide:

1. Two flows declaring overlapping identifier namespaces — one flow's find-or-create
   would then adopt the other's rows.
2. A flow exporting a string that lands inside another flow's namespace — a fixture
   pointing at a row this flow does not own.
3. Two flows claiming the same fixture key — the later one would silently overwrite
   the earlier.
4. A flow exporting an id belonging to a company another flow owns — cross-flow
   coupling that breaks the moment either flow changes.

The guards police what flows *export*. Namespace discipline inside a flow's own runtime
queries — and a spec that squats a namespace at runtime — is by hand.

**Go through real business functions** with real contexts for anything with domain
invariants; raw Kysely writes are for skeleton rows (users, organizations, roles) only.
And **dedicate entities to mutating scenarios**: never let a spec that writes share
seeded personas or records with the specs that read.

### Convergence

Every seeded row is find-or-create on a stable natural key, and a found row is driven
into the state the flow wants — in the append-only style, derive the current state and
append the correcting event only when it differs. A `doNothing()` conflict clause does
not converge a row a spec mutated on a previous run.

- Never a blind insert; a second flow calling the same helper, or a second run of the
  same flow, would double the row.
- Never `Date.now()` or a random suffix in a seeded identifier — that defeats
  convergence and grows the database forever, filling the product pickers the specs
  type into.
- A query that gathers broadly must filter out other flows' namespaced rows — a
  *contains* match on the namespace marker, not a prefix one — and must be able to
  shed rows it absorbed before the filter existed: a convergent seed corrects the state
  a previous version of itself created.

**Consumable pools.** Some journeys spend their fixture: receiving a delivery line,
submitting a one-shot form. Those flows seed a pool instead of a single row, one slot
per attempt the test can make, and derive per slot whether it is spent, reusing
pristine slots and appending a replacement only for a spent one. The spec draws its
slot with `poolSlot`:

```typescript
test('…', async ({ page }, testInfo) => {
  const purchaseOrderId = poolSlot(
    fixtures.receiving.receiveDrawerPoIds,
    testInfo,
    { pool: 'receive drawer purchase order', flow: 'receiving' }
  )
```

Playwright runs one test more than once for two independent reasons, so the slot is the
pair of both: `testInfo.repeatEachIndex * (testInfo.project.retries + 1) +
testInfo.retry`. Indexing by `testInfo.retry` alone puts every `--repeat-each` copy on
the same slot. `poolSlot` throws when the index runs past the pool, naming the
`SLOT_COUNT` constant to grow.

`SLOT_COUNT` is 1 + the CI retry count. It must rise if `retries` in
`playwright.config.ts` ever does, or if a run needs more repeats than the pool holds —
the exhaustion error is the signal.

### Personas

The seed mints one `storageState` file per persona into `tests/.auth/` by writing the
app's own session cookie, so a persona is a real session, not a fabricated cookie. The
roster lives in the flows themselves — every `mintStorageState` call in
`tests/seed/flows/*.ts` mints one persona; enumerate them with
`grep -rn "mintStorageState(" tests/seed/flows/`.

**There is no default storageState.** A spec that declares none runs signed out. A spec
adopts a persona at the top of the file:

```typescript
test.use({ storageState: 'tests/.auth/state.json' })
```

A second actor in the same spec comes from `browser.newContext({ storageState })`. Sign
in through the UI only where authentication *is* the subject — the magic-link journey,
which polls the mail catcher's web API for the real email.

To add a persona, mint it inside the flow that owns its user and company, and export
whatever the spec needs to address it. Prerequisite lookups throw naming the missing
key rather than defaulting — a flow never papers over a missing dependency.

### Spec conventions

- **One `test()` per file**, and the filename is the behavior sentence in kebab-case:
  `receiving-reschedules-a-delivery-to-a-free-slot.spec.ts`. Any number of assertions
  inside; the limit is on `test()` calls. An older file carrying a bare area name
  predates the rule: rename it to its behavior sentence when you next rewrite it, and
  never add a new area-named file.
- **Never touch the database and never read `process.env`.** Everything a spec needs
  comes from the seed's fixtures file and from Playwright's `baseURL` — never a
  hardcoded port or origin, which would reach whichever worker happens to hold that
  port rather than the one running the spec. The mail catcher's port is the one
  sanctioned environment value, and it arrives through fixtures too.
- **Select the way a user perceives the page**: `getByRole`, `getByLabel`,
  `getByPlaceholder` with the product's real copy. No test ids. Absence is
  `await expect(locator).toHaveCount(0)`, never a negated visibility check.
- `getByRole`'s `name` matches **substrings** by default, and so does `getByLabel`. In
  a dialog or list that also renders seeded content, a one-word name eventually
  collides with another flow's row whose accessible name contains that word, and the
  collision only appears once both flows share a database. Indexed accessible names
  collide with their own siblings the same way: `Location for item 1` is a substring of
  `Remove location for item 1`. Pass `exact: true` whenever the target's accessible
  name is short, is a prefix/suffix of a sibling's, or the surrounding surface lists
  content other flows write. (React Testing Library's `name` is exact by default — a
  form can pass its unit tests and still break a Playwright spec this way.)
- `toHaveText` reads `textContent`, which includes nodes hidden with `display:none`. A
  face whose primitive renders a hidden twin — a `print:hidden` label beside a
  `hidden print:inline` one — therefore reads as both strings run together, and an
  unset value can assert as its placeholder plus the em-dash. Assert what a person sees
  with `{ useInnerText: true }` on any face that carries twins. Adding a twin to a
  shared primitive changes what specs read on every face that primitive renders, so
  grep `tests/` for exact-text assertions on those faces in the same change.
- **Assert display strings that came from fixtures**, so the seed and the spec cannot
  drift apart — never a string the spec restates. Importing an app module that is safe
  on both sides for copy or constants is encouraged; importing a server-only module is
  not — it would drag the database and env into the test process.
- **Prove persistence by round trip**: mutate, re-navigate, assert the durable state.
- **Never assert an exact count or completeness of a shared list.** Sibling flows and
  future seeds add rows to the same lists. Scope the assertion to the row the spec is
  about with `filter(...)`.
- **A paginated list hides the rows a growing seed pushed off page one.** Every flow's
  seeded rows already fill the directory, and the spec's own retries and
  `--repeat-each` repetitions each add more, so a spec that opens a list to find its
  own row is one seeded row from red. Scope the list with the surface's own search or
  filter, or ask for a page wide enough to hold everything — and identify the row by
  something intrinsic to the record, `filter({ has: page.locator('[href="/items/<id>"]') })`,
  rather than by text plus `.first()`, which quietly matches a sibling flow's row.
- `filter({ has: ... })` re-roots the inner locator at each candidate, so a locator that
  reads correctly can match nothing once it is nested in a helper. Build the inner
  locator relative to the candidate, and check the count you expect.
- Renaming or removing user-facing copy means grepping all of `tests/` for the old
  string. A lane's own subset run will not catch cross-file drift; CI will.

### Flash messages

Specs never assert one-shot flash messages. Their delivery rests on a global
no-prefetch property any future change can silently break — a viewport prefetch
consumes the one-shot flash cookie before the page you are watching reads it — failing
every such assertion at once. Assert `toHaveURL` on the destination plus the
re-navigated state instead.

### Retry safety is the bar

CI retries a failed spec, and a retry re-runs inside the same worker — the same clone,
the same port. A fresh clone per run buys a spec nothing here: the rows the failed
attempt wrote are still in front of the retry. A spec is correct only if it passes when
re-run against the state an attempt that **died at any line** left behind — not merely
when re-run after a clean pass. That is why cleanup-at-the-end is never the answer: the
attempt that mattered never reached the cleanup.

Two patterns satisfy the bar:

- **A convergent prologue**: start by driving the world into the state the spec needs
  (delete the leftover copy, close the open record, clear the filter) — or build and
  approve the record the journey consumes through the UI first — instead of assuming a
  pristine world.
- **Attempt-unique identity**: name the thing you create per attempt, or draw from a
  seeded pool with `poolSlot`, which indexes by `repeatEachIndex` and `retry`. A pool
  must hold at least as many entries as CI can attempt (1 + the retry count, per
  repeat), or a spec that mutates then fails exhausts it and the next attempt fails for
  the wrong reason.

Making an operation one-way — an answer that cannot be rewritten, a record that submits
once — retroactively breaks every spec that performs it, however well written: the
attempt that died leaves a resource no later attempt can drive, so every retry fails
for the wrong reason. A change that removes repeatability from a flow carries the duty to
move every spec that drives it onto a per-attempt pool in the same change.

**Proving it**: `--repeat-each=3` only proves the *happy path* is repeatable — it
cleans up after itself every time. To prove death-safety, simulate the death inside a
single Playwright invocation: put a throwaway simulated-death test above the real one
that performs the mutation and stops, or abort mid-spec on the first attempt
(`expect(test.info().retry).not.toBe(0)`), then run with `--workers=1` and watch the
real spec pass on the retry. Pair it with a negative control — the same run without the
convergent prologue must fail — or you have proven nothing.

### Racy by design: what to wait for

Never mask a flake with a wait, a retry, or a weakened assertion. A spec that fails
intermittently is a likely product bug until investigated. And a green E2E job is no
evidence a spec is healthy: the run names every test that only passed on a retry, and
those names are read rather than waved through. What follows is what to wait for when
the surface is racy *by design*:

- **Hydration.** Never navigate or click immediately after `page.goto()` on a route with
  a hydrating `clientLoader`: the server HTML is interactive before the client router
  takes over, and the first click is swallowed. Wait for
  `window.__reactRouterDataRouter.state.initialized === true` first, wrapped in the
  page-opening helper the spec family shares. Reproduce a CI-only race locally with CDP
  `Emulation.setCPUThrottlingRate` at 8–20×. A failure that is intermittent across runs
  but deterministic within an attempt is a machine-speed race, not bad state.
- **Debounced inputs.** A debounced search field navigates only after its delay, and
  `fill()` returns immediately — assertions written right after it can pass against the
  previous DOM (a false green that survives deleting the feature), and the next `fill()`
  cancels the still-pending submit outright. After each fill, assert the URL carries that
  step's term, percent-encoded — `await expect(page).toHaveURL(new RegExp('q=' +
  encodeURIComponent(term)))` — before asserting content.
- **Synchronous flows wait on the action itself.** Wait for the action's POST response:
  match on method `POST` and the `.data`-stripped pathname **exactly** — a suffix match
  can settle early against the route's own JS bundle, which shares the path.
- **Eventual consistency.** A reload-until-assertion loop
  (`expect(async () => { await page.reload(); … }).toPass()`) is reserved for surfaces
  that are eventually consistent **by design** — webhook- or worker-driven state, or a
  cached client loader plus polling, where the first paint after a mutation
  legitimately shows stale data. Each use carries a one-line justification naming the
  asynchronous producer it waits on — and by re-navigating it also proves persistence.
  Wrapping a flow that *should* be synchronous in `toPass` to make it green is the
  anti-pattern, and can hide a real product race for months.
- **After a mutation whose action redirects**, assert the transition before clicking
  anything on the destination: `toHaveURL` on the target, then the destination's state.
  A click fired while the destination route is still remounting can lose its navigation
  under CI load, and the URL assertion makes any future failure say whether the
  navigation happened at all.
- **Mail polling.** A spec that signs in by magic link as a **seeded** email must only
  accept a message that arrived after this attempt requested one — one mail catcher
  serves every worker and every attempt, so an unfiltered poll picks up an earlier
  attempt's already-consumed link on the second `--repeat-each` repetition or a CI
  retry. Record the request time and filter on it. Specs that mint a fresh email per
  run are immune.

### Clock doctrine

- The seeded world is anchored to **one rolling date computed once in SQL**, off
  `(now() at time zone 'utc')::date`, and display strings are formatted in SQL with
  `to_char` and exported through fixtures. No `Date.now()` in seeds, and no absolute
  date in a spec — a hardcoded `'2027-06-01'` silently becomes a past date once the
  wall clock passes it, flipping expiry-derived UI and any not-past validation the form
  later gains. Compute a typed date relative to today.
- The anchor is a **UTC** date; the business's days run in its own timezone. Compute
  any day boundary in SQL against that timezone.
- **Fresh-database class of failure.** CI builds the E2E database from scratch, so a
  seeded row backdated relative to `now()` can predate a configuration row created
  seconds earlier, and "the setting active at time X" correctly resolves to nothing —
  the causal order the product assumes is inverted. The fix is to rewrite the seeded
  history onto a one-second ladder ending yesterday, never a wait and never a weakened
  assertion. Reproduce by dropping the E2E database and running immediately.
- **Wall-clock independence.** A predicate like "a slot still available today" goes
  empty late enough in the day — specs that pass all afternoon fail deterministically
  after business hours. Derive the seeded window from the data it must serve, computed
  in SQL from the seeded records themselves, and fail loudly if there is none.

### LLM-backed jobs

When the product runs LLM-backed jobs, the suite ships no LLM stub by default: the real
worker executes real jobs, and a job that calls the provider SDK cannot work in CI,
where every provider key is a placeholder. Two established patterns cover every case:

- **Fabricate the output in the seed.** Write the rows the job *would* have written (an
  analysis run, an extraction row with its reading) and let the spec assert the UI over
  them. This is how success paths are exercised.
- **Drive the enqueue, expect the failure path.** A spec may exercise the real
  enqueue-to-job flow and assert the failure state the UI shows — but only while that
  failure is deterministic in every environment. The day keys or storage are unified so
  the call could succeed somewhere, an LLM stub (the fake-provider endpoint pattern)
  must ship before any such spec, or it goes non-deterministic.

Never assert exact model output anywhere, and never write a spec whose premise requires
a real model to behave a particular way.

### The mobile project

`*.mobile.spec.ts` files run under the mobile project's phone profile; everything else
runs under `chromium`, and each project ignores the other's pattern so nothing runs
twice. Write a mobile spec only when a journey is genuinely different on a phone — a
collapsed sidebar, a bottom dock, an icon-only control, a long article — never to
duplicate desktop coverage. Assert what proves the layout works: navigation is
reachable, content is readable, primary actions are tappable (`click({ trial: true })`
runs Playwright's full actionability check without firing the action), and the page
does not scroll sideways. Never assert pixel values.

### Env parity

Anything a run depends on goes in **both** places, in the same change: `.env.test`
(gitignored, local only) and the workflow-level `env:` block in the CI configuration.
CI has no `.env.test`, so an env var added to only one of the two passes locally and
fails on the pull request.

Repointing a provider URL env var (a `*_API_BASE_URL`, an OAuth authorize/token URL)
reroutes every existing spec whose journey touches that provider, not just yours. When
an authorize URL moves from the provider's own domain to an in-app stand-in, a merged
spec that stubbed off-origin traffic and waited to leave the origin starts timing out —
its journey now never leaves. Before repointing, grep `tests/` for specs driving that
provider and rework any that assume the old destination.

### Overlay clicks

Inside fixed-position overlay containers (modals, drawers, side panels), a click on an
element below the overlay's visible fold can silently no-op instead of auto-scrolling it
into view — in Playwright-driven browsers and agent-browser alike. The same applies to
ordinary page scroll: a submit button far below the fold of a small viewport can no-op
the same way. Scroll the container (or page) first, then click. When a click "does
nothing" during manual verification, reproduce with a user-style scroll-and-tap before
concluding the control is broken; the silent no-op is a harness artifact, not a product
bug.

A second agent-browser artifact: when an action changes the target's accessible name (a
toggle whose `aria-label` flips between "Add X" and "Remove X"), `check`/`uncheck`
report "Element not found" AFTER succeeding — the tool re-locates the element by its
old name to confirm. Verify the state change instead of trusting the error.

### When CI fails and your machine does not

- Failure artifacts come from Playwright's `test-results/` (screenshots and first-retry
  traces) and the harness's `tests/.artifacts/` (the per-worker stack logs and the
  route logs). There is no HTML report: the suite runs the `list` reporter.
- A pull request showing **"No checks reported"** is not a CI outage — it conflicts with
  `main`, GitHub cannot build the merge commit, and it silently skips the workflows.
  Rebase.
- **Measure before theorizing.** `gh run download <runId>` fetches the failing retries'
  Playwright traces; their `.network` entries carry per-request timings. Compare them
  with a locally traced run of the same spec (`--trace on`): a data request that costs
  ~100ms locally routinely costs 2–4s on a two-core CI runner, so a post-action
  assertion bounded by the default 5s expect window sits on a cliff whenever a page's
  round trips stack up. The suite's heaviest page earns specs that assert through a
  widened `expect.configure({ timeout: 15_000 })` for exactly this reason — reuse that
  pattern for any new spec on a comparably heavy page.
- **Two cheap experiments before blaming your diff.** Rerun the failed job on the
  unchanged commit (`gh run rerun <runId> --failed`): a pass proves there is no
  deterministic regression in the diff. And read the failing spec's duration off recent
  *green* main runs (`gh run view <id> --log | grep <spec>`): a spec whose green-run
  duration has been climbing toward its budget (say 5.5s → 9.8s → 28.6s against 30s)
  was already on a cliff, and any branch's run merely tips it. When that trend exists,
  the fix is the page's cost — count statements from the Postgres log and remove the
  duplicated work — not a bigger budget; halving a heavy page's round trips can cut
  minutes off the whole suite.
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

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/testing.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
