---
name: testing
description: Write and run tests using Vitest (unit tests) and Playwright (E2E tests). Use when writing tests, fixing tests, running tests, implementing TDD, or when user mentions testing, test-driven development, Vitest, Playwright, unit tests, or E2E tests.
---

# Testing

Comprehensive testing guidelines covering unit testing, E2E testing, test organization, and test-driven development workflows.

## Test Execution Commands

```bash
pnpm run test:unit                            # Every unit test
pnpm run build && pnpm run test:e2e           # Build, then the Playwright suite and the coverage gate
pnpm run test                                 # Both suites in parallel
```

**Important**: Always run tests before committing changes.

The full E2E suite is CI's job, not a local step. Run at most the specs a change directly touches (`pnpm run build && pnpm run test:e2e tests/<spec>.spec.ts`), open the PR once lint, `tsc`, and `test:unit` pass, and treat the CI E2E job as the acceptance gate. A change to the seed or to the E2E runner touches every spec, so there the full suite is the directly-touched set.

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

False-green smells to check whenever a test passes suspiciously easily: the expected value coincides with the old buggy behavior (the test passes whether the bug is fixed or not); the code path is stubbed above the change under test; an error assertion satisfied by a different error than the one under test firing first.

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
describe('revokeUserSession', () => {
  it('inserts nothing when the session does not exist', async () => {
    // test implementation
  })

  it('appends a revocation event for the session', async () => {
    // test implementation
  })
})
```

### Assertion Best Practices

- Prefer expressive matchers such as `toContain`, `toContainEqual`, or `containSubset` instead of manual array scans with `.some`
- When validating failure cases, assert on the specific error (name or class) rather than only checking `result.success === false`
- An absence assertion pinned to an exact accessible name is a silent false-pass when the element's real name is a concatenation of child spans — `queryByRole('link', { name: 'Connect Odoo' })` can match nothing whether or not the element is present. For absence, match on a regex or unique text, and mutation-prove it by rendering the element and watching the assertion fail.

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

`app/test/dna-ground-truth-fixtures.ts` carries a customer's real workbook as typed data, read by both the unit suite and the E2E recipe seed flow. Three rules keep such a fixture trustworthy:

- Every number names the workbook, sheet, and cell it came from in a **data field**, never a comment, so the citation travels with the value and a reviewer can re-open the source.
- A disagreement between the fixture and the product is a product finding. Never edit the fixture to make an assertion pass — that converts the only independent evidence into a restatement of the code.
- Where the product deliberately departs from the source, assert the departure as the formula that generates it (`scaledWeighOut − workbook === target × loss² / (1 − loss)`), never as the constant it happens to equal today.

### Database Testing

- **Never delete or update records in unit tests** — the schema is append-only, and tests follow the same doctrine
- Instead, insert records with random identifiers and query by those identifiers
- The database is not cleaned between tests, allowing tests to run in parallel

### Parallel safety

The suite runs many test files concurrently against one shared database. Three patterns flake under that concurrency:

- Never assert on an unscoped aggregate (`count(*)` without a filter tied to rows this test created) over tables other test files also write to — scope every count to the entity under test.
- Random needles for search/substring tests need real entropy: use `crypto.randomUUID()`, not a few hex characters that can collide with other fixtures. zod's `.uuid()` also validates RFC4122 version/variant bits, so hand-typed ids like `'11111111-1111-1111-1111-111111111111'` fail validation — generate fixture ids.
- Shared lazily-initialized infrastructure (a schema, a singleton) must be bootstrapped once in global setup, not on first use per test file — concurrent first uses race the initialization.

A run that reports every test passing yet exits 1 with Vitest's "Unhandled Errors" block ("caught after test environment was torn down") has work outliving a test file — a mounted React root with a queued render, a timer such as msw's `delay('infinite')` (a ~24-day `setTimeout`; stall on the request's abort signal instead, see `stallUntilTheCallerGivesUp` in `app/test/msw-setup.ts`), an unawaited insert. Fix the abandonment at its source; never suppress or ignore the error. These flakes live in a narrow scheduling window — plain full-suite runs can go many runs without a hit — so reproduce with oversubscribed workers (`--maxWorkers` well above the core count) and prove the fix by instrumenting what is still pending at end-of-file, not by clean runs alone.

When pinning not-found behavior, assert on `RecordNotFoundError`'s `.message` (`'Record not found'`) — its `.name` stays `'Error'`.

A hand-built business-function context carries real ids from its fixtures — `currentCompany.organizationId` from the created company, never an `''` placeholder. Queries compare context ids against uuid columns, so a placeholder cast-errors at runtime, and one that passes today fails the moment the function under test gains another scoped join. Placeholder text is only safe in fields no query consumes, like `organizationName`.

Example:
```typescript
it('appends a revocation event for the session', async () => {
  const userId = crypto.randomUUID()
  await db()
    .insertInto('users')
    .values({ id: userId, email: `${userId}@test.example.com` })
    .execute()
  const session = await createUserSession({
    userId,
    ipAddress: null,
    userAgent: null,
  })

  const revocation = await revokeUserSession(session.id)

  expect(revocation?.userSessionId).toBe(session.id)
})
```

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

E2E tests use Playwright and drive complete user journeys through the built app in a real browser.

### Running the suite

`pnpm run test:e2e` is `tsx ./tests/run-e2e.ts`: it runs `pnpm exec playwright test` with every argument passed straight through, and then runs the route coverage gate. Pass Playwright flags with no `--` separator — `pnpm run test:e2e tests/foo.spec.ts --repeat-each=3`. pnpm forwards a literal `--`, and Playwright then silently ignores everything after it.

Always `pnpm run build` first. The suite runs against the built bundle with `NODE_ENV=test`, and the route observer the coverage gate reads lives inside that bundle.

### One product per Playwright worker

Four Playwright workers run at once, and a worker here is a whole product rather than a browser. `playwright.config.ts` starts one process only — maildev, which every worker shares, because specs read their mail by recipient address. Everything else belongs to the worker: the `appStack` fixture in `tests/harness.ts` spawns that worker's own `server.js` and its own `run-worker.ts` against its own database, on the lane's `PORT` plus the worker's index, and hands the spec the `baseURL` that reaches it (`tests/worker-stack.ts`).

**A spec imports `test` and `expect` from `./harness`**, never from `@playwright/test` — only types come from there. That fixture is the whole of what supplies `baseURL`, since the config sets none, so a spec taking Playwright's own `test` fails on its first relative `page.goto`.

A file is the unit of parallelism: `fullyParallel` is false, so the tests inside a file run in order in one worker, and therefore against one database, and can build on each other's state.

`tests/worker-stack.ts` is the only place that sets `E2E_ROUTE_LOG`, one log file per worker. It also moves every address in the environment that points the product back at itself — the Stripe, QuickBooks and Anthropic stubs it calls are its own routes — from the lane's port to the worker's. The move is a textual swap of `localhost:<lane port>`, so a new self-referencing URL is written in exactly that shape; spell it any other way and every worker's stub traffic lands in the first worker's database.

A stray process holding a worker's port fails the run by name after thirty seconds (`Port … is still held, so the E2E worker cannot start its own app server there.`) rather than being adopted. Stop a server left over from `pnpm run dev` before a run.

Both of a worker's processes append to `tests/.artifacts/stack-<index>.log`, in the order things happened. React Router says nothing about a failed request while it serves in test mode, so that file is the only account a run leaves of a 500; CI uploads it beside the Playwright report.

Four workers, on CI and on a laptop alike. Each stack asks Postgres for around twenty connections at its busiest, and four fit inside the hundred a stock Postgres offers — the five that Playwright's core count picks on a larger machine do not, and the run dies with `sorry, too many clients already` surfacing as an unexplained 500.

### Database ownership

The Playwright suite owns the database named by `.env.test` outright. The unit suite derives a database of its own from that same connection string (`app/test/global-setup.ts`, via `unitDatabaseUrl`) and never touches the E2E one.

`tests/global-setup.ts` seeds that canonical database once — `tests/seed/seed-e2e.ts` creates it if missing, migrates it, and converges every flow onto it — and then clones it per worker as `<name>_w<index>`. It drops the clones the last run left before making this run's, and Postgres copies a template only while nothing is connected to it, so connections to the canonical database are closed first and the clones are made one at a time.

The canonical database is deliberately long-lived and never reset: a database that survives is what forces the seed to be convergent. To start it over, drop it by hand and rerun the suite.

No spec touches it. A spec runs against its worker's clone, which is dropped and re-made from the seed at the start of the next run, so nothing a spec writes outlives the run that wrote it.

### The route coverage gate

Coverage is measured from real traffic, never asserted.

- **Observation** — `server/app.ts` appends each request path to the file named by `E2E_ROUTE_LOG`, which is one log per worker. The middleware only exists when that variable is set, so no other run pays for it. It skips requests carrying a prefetch `Sec-Purpose` or `Purpose` header: a link the browser warmed on its own must not count as a visit.
- **Inventory** — `tests/coverage/inventory.ts` derives one route id per entry in `app/routes.ts` from that entry's route file. Pathless layouts leave the denominator (a layout is reached whenever a child is), and two entries backed by one file throw, since ids are synthesized from the filename.
- **Replay** — `tests/coverage/gate.ts` feeds the log through React Router's own `matchRoutes`, so the URL-to-route-id mapping is the app's. What the run reached is the union of the per-worker logs (`tests/coverage/route-log.ts`), and a run that left no log at all throws rather than reporting an empty picture. A client navigation asks for `<pathname>.data`, and `/_root.data` at the root, so the gate resolves both back to the visitor's path first. React Router's `/__manifest` endpoint is skipped — the catch-all route would otherwise count it as a visit to the not-found page.

Global setup deletes the previous run's logs, so the gate always reads exactly one run's traffic.

The gate fails five ways, each naming its fix:

1. An uncovered route listed in neither registry.
2. An `exclusions.ts` entry — or an `EXCLUDED_PREFIXES` prefix — for a route that no longer exists.
3. A `pending.ts` entry for a route that no longer exists.
4. A listed route the suite already reaches.
5. A route listed in both registries.

It enforces only on an unfiltered run. A spec path, `--grep`, `-g`, `--grep-invert`, `--project`, `--shard`, `--last-failed`, or `--only-changed` drops it to reporting, because a partial run cannot know what the rest of the suite would have reached. `--workers`, `--repeat-each`, and `--reporter` change how the suite runs, not which specs run, and keep it enforcing, in both the `--flag=value` and `--flag value` forms.

Run the gate standalone against the last run's log with `pnpm exec tsx ./tests/coverage/gate.ts`, or `pnpm exec tsx ./tests/coverage/gate.ts --report` to print the numbers without failing.

Rehoming a surface's writes mints new action routes — the route is new even though the behavior it carries is old, and nothing reaches it until a spec drives that write on its new home. A change that moves writes moves the specs that drive them, in the same PR. Filtered local runs drop the gate to reporting, so only the unfiltered CI run says whether a rehomed route is covered.

`tests/coverage/pending.ts` carries the routes no spec reaches yet and only ever shrinks — the gate fails the moment a spec reaches a parked route, so the entry comes out in the same PR. A new route lands in `pending.ts` in the same PR that adds it unless a spec reaches it. `tests/coverage/exclusions.ts` takes a route only with a written rationale citing the unit test that owns the behavior end to end, or proof the route is unreachable from the product; `EXCLUDED_PREFIXES` does the same for a whole subtree. "No spec yet" is not a rationale — that is `pending.ts`.

### The seed

`tests/seed/seed-e2e.ts` is a thin orchestrator over one module per journey in `tests/seed/flows/`. `tests/seed/context.ts` holds the date anchor, session minting, and the prerequisite lookups; `provisioning.ts` and `catalog.ts` hold the primitives the flows share.

A flow module exports three things:

- `namespaces` — the identifier prefixes it reserves (names, codes, note strings).
- `companies` — the organization and company names it owns.
- `seed(context)` — returns the flow's fixtures.

The orchestrator discovers `tests/seed/flows/*.ts` in filename order and merges each flow's return value under its filename stem, so **filename order is dependency order** and fixtures are nested: `fixtures.receiving.approvedPoId`, `fixtures.picking.pickingIds`. `account.ts` sorts first and seeds the base account and company every later flow leans on. A flow that creates an organization seeds its own Administrator role (`seedAdministratorRoleForOrganization`) rather than assuming another flow did. The fixture keys the orchestrator owns are `dates` and `maildevWebPort`, listed in `BASE_FIXTURE_KEYS` so no flow can claim them.

Four guards fail the seed loudly, and each catches a distinct way flows collide:

1. Two flows declaring overlapping identifier namespaces — one flow's find-or-create would then adopt the other's rows.
2. A flow exporting a string that lands inside another flow's namespace — a fixture pointing at a row this flow does not own.
3. Two flows claiming the same fixture key — the later one would silently overwrite the earlier.
4. A flow exporting an id belonging to a company another flow owns — cross-flow coupling that breaks the moment either flow changes.

The guards police what flows *export*. Namespace discipline inside a flow's own runtime queries is by hand.

### Convergence

Every seeded row is find-or-create on a stable natural key, in the append-only style: derive the current state, and append the correcting event only when it differs. `ensureRoleRemoved` in `tests/seed/provisioning.ts` is the shape — it checks whether the user holds the role and appends a removal only then, so a repeat run appends nothing.

- Never a blind insert; a second flow calling the same helper, or a second run of the same flow, would double the row.
- Never `Date.now()` or a random suffix in a seeded identifier — that defeats convergence and grows the database forever, filling the product pickers the specs type into.
- A query that gathers broadly must filter out other flows' namespaced rows, and must be able to shed rows it absorbed before the filter existed — a convergent seed corrects the state a previous version of itself created.

**Consumable pools.** Some journeys spend their fixture: receiving a line, declining a receipt, validating a supplier return, and picking a line are one-way. Those flows seed a pool instead of a single row, one slot per run of the test, and derive per slot whether it is spent, reusing pristine slots and appending a replacement only for a spent one (`tests/seed/flows/receiving.ts`, `tests/seed/flows/picking.ts`). The spec draws its slot with `poolSlot` from `tests/pool-slot.ts`:

```typescript
test('…', async ({ page }, testInfo) => {
  const purchaseOrderId = poolSlot(
    fixtures.receiving.receiveDrawerPoIds,
    testInfo,
    { pool: 'receive drawer purchase order', flow: 'receiving' }
  )
```

Playwright runs one test more than once for two independent reasons, so the slot is the pair of both: `testInfo.repeatEachIndex * (testInfo.project.retries + 1) + testInfo.retry`. Indexing by `testInfo.retry` alone puts every `--repeat-each` copy on the same slot. `poolSlot` throws when the index runs past the pool, naming the `SLOT_COUNT` constant to grow.

`SLOT_COUNT` is 1 + the CI retry count (currently 4, for `retries: 3`), which covers CI's one attempt at `--repeat-each`. It must rise if `retries` in `playwright.config.ts` ever does, or if a run needs more repeats than the pool holds — the exhaustion error is the signal.

### Personas

The seed mints one `storageState` file per persona into `tests/.auth/` by writing the app's own session cookie (`mintStorageState` in `tests/seed/context.ts`, setting `currentUserId` and `currentCompanyId`), so a persona is a real session, not a fabricated cookie. The roster lives in the flows themselves — every `mintStorageState` call in `tests/seed/flows/*.ts` mints one persona (nineteen today, from the base admin `state` at Acme Foods to per-area operators like `mcp-operator`, `integrations`, and `staff-schedule`); enumerate them with `grep -rn "mintStorageState(" tests/seed/flows/`.

**There is no default storageState.** A spec that declares none runs signed out. A spec adopts a persona at the top of the file:

```typescript
test.use({ storageState: 'tests/.auth/state.json' })
```

To add a persona, mint it inside the flow that owns its user and company, and export whatever the spec needs to address it. Prerequisite lookups (`requireUser`, `requireCompany`) throw naming the missing key rather than defaulting — a flow never papers over a missing dependency.

### Spec conventions

- **One `test()` per file.** Multiple assertions per test are fine; the limit is on `test()` calls. The filename is the behavior sentence in kebab-case (`tests/receiving-qc-decline.spec.ts`, `tests/auth-guard-redirects-every-protected-area.spec.ts`). Some older files carry area names (`picking.spec.ts`, `employees.spec.ts`) — they predate this rule; rename one to its behavior sentence when you next rewrite it, and never add a new area-named file.
- Never touch the database from a spec, and never read `process.env`. Everything comes from `tests/.auth/fixtures.json` and Playwright's `baseURL` — never a hardcoded port or origin, which would reach whichever worker happens to hold that port rather than the one running the spec.
- Select by accessibility with the product's real copy (`getByRole`, `getByLabel`, `getByPlaceholder`). No test ids.
- `getByRole`'s `name` matches **substrings** by default, and so does `getByLabel`. In a dialog or list that also renders seeded content — the shared company's stock items, departments, contacts — a one-word name like `Kitchen` eventually collides with another flow's row whose accessible name contains that word, and the collision only appears once both flows share a database. Indexed accessible names collide with their own siblings the same way: `Location for item 1 allocation 1` is a substring of `Remove location for item 1 allocation 1`. Pass `exact: true` whenever the target's accessible name is short, is a prefix/suffix of a sibling's, or the surrounding surface lists content other flows write. (React Testing Library's `name` is exact by default — a form can pass its unit tests and still break a Playwright spec this way.)
- Absence is `toHaveCount(0)`, not a negated visibility check.
- `toHaveText` reads `textContent`, which includes nodes hidden with `display:none`. A face whose primitive renders a hidden twin — a `print:hidden` label beside a `hidden print:inline` one — therefore reads as both strings run together, and an unset value can assert as its placeholder plus the em-dash. Assert what a person sees with `{ useInnerText: true }` on any face that carries twins. Adding a twin to a shared primitive changes what specs read on every face that primitive renders, so grep `tests/` for exact-text assertions on those faces in the same change.
- Assert the display strings the seed formatted in SQL and exported through fixtures (`fixtures.dates.approvedMonthLabel`), never a string the spec restates — that is how seed and spec drift apart.
- Never assert an exact count on a list other flows also write into. Scope the assertion with `filter({ hasText })` on the row the spec is about.
- A spec that creates a row and then asserts it on a paginating list must first scope that list with the surface's own search or filter. Every flow's seeded rows already fill that directory, and the spec's own retries and `--repeat-each` repetitions each add another to the same clone, so an assertion that trusts the first page fails as soon as the surface crosses the page size (`tests/employees.spec.ts` searches for the email it just created).
- Prove persistence by round trip: mutate, re-navigate, and assert the durable state — not just the optimistic render.
- Renaming or removing user-facing copy means grepping all of `tests/` for the old string. A lane's own gates will not catch cross-file E2E drift; CI will.

### Retry safety

CI retries a failed spec 3 times, and a retry re-runs inside the same worker — the same clone, the same port. A fresh clone per run buys a spec nothing here: the rows the failed attempt wrote are still in front of the retry. A spec is correct only if it passes when re-run against the state an attempt that died at **any** line left behind. Cleanup at the end of the test is never the answer — the attempt that dies never reaches it.

Two sanctioned patterns:

- **A convergent prologue** — drive the world into the state the test needs before testing it. `tests/receiving-actions.spec.ts` builds and approves its own purchase order through the UI before receiving it.
- **Attempt-unique identity** — per-attempt naming, or a seeded pool drawn with `poolSlot`.

Prove it, do not assume it. The ritual: write a throwaway test that performs the mutation and then aborts on attempt 0, run with `--workers=1`, and watch the retry pass. Pair it with a negative control — the same run *without* the prologue must fail. Without the control, a passing retry proves nothing. `--repeat-each=3` alone only proves the happy path repeats; it never exercises a half-finished attempt.

### Flakes and waiting

Never mask a flake with a wait, a retry, or a weakened assertion. A spec that fails intermittently is a likely product bug until investigated. A green E2E job is no evidence a spec is healthy: the run names every test that only passed on a retry, in a block after the suite and as a GitHub Actions warning on the run, and those names are read rather than waved through.

- For a **synchronous** flow, wait for the action's POST response: match on method `POST` and the `.data`-stripped pathname **exactly**. A suffix match can settle early against the route's own JS bundle, which shares the path.
- A reload-until-assertion loop (`expect(async () => { await page.reload(); … }).toPass()`) is reserved for surfaces that are eventually consistent **by design** — webhook- or worker-driven state, as in `tests/billing-dunning.spec.ts`. Each use carries a one-line justification saying which asynchronous producer it is waiting on.
- Do not build helper abstractions for either pattern before a spec needs one. When one does, this is the contract it implements.
- A spec that signs in by magic link as a **seeded** email must only accept a MailDev message that arrived after this attempt requested one — one MailDev serves every worker and every attempt, so an unfiltered poll picks up an earlier attempt's already-consumed link on the second `--repeat-each` repetition or a CI retry (`tests/signed-in-operator-reviews-their-profile-reports-a-bug-and-signs-out.spec.ts` records the request time and filters on it). Specs that mint a fresh email per run are immune.

After a mutation whose action redirects, assert the transition before clicking anything on the destination: `toHaveURL` on the target, then the destination's state. A click fired while the destination route is still remounting can lose its navigation under CI load, and the URL assertion makes any future failure say whether the navigation happened at all.

**Flash assertions.** Specs assert flash messages after redirecting mutations, and that is sound today because nothing in the app prefetches (`grep -rn prefetch app/` returns nothing). The hazard to know: a flash cookie is one-shot, consumed by whichever request reads it first. The day a prefetch hint or a second root fetch appears, every flash assertion becomes flaky at once. The durable alternative is `toHaveURL` plus the re-navigated state.

### Clock doctrine

- One rolling anchor, computed once in SQL: `computeSeedDates` in `tests/seed/context.ts`, off `(now() at time zone 'utc')::date`.
- Display strings are formatted in SQL with `to_char` and read from fixtures. A spec never restates a formatted date.
- No `Date.now()` in the seed, and no absolute date in a spec. A hardcoded `'2027-06-01'` silently becomes a past date once the wall clock passes it, flipping expiry-derived UI and any not-past validation the form later gains. Compute a typed date relative to today.
- Day boundaries are computed in SQL, in the company's timezone.
- New seeded history must not backdate rows relative to configuration created moments earlier — on a fresh database that inverts the causal order the product assumes.

### Mobile specs

`*.mobile.spec.ts` runs under the `mobile` project (Pixel 7); everything else runs under `chromium`. Write one only when the journey genuinely differs on a phone. Assert reachability, readability, and tappability, and that the page does not scroll sideways — never pixel values.

### Env parity

Anything a run depends on goes in **both** places, in the same change: `.env.test` (gitignored, local only) and the workflow-level `env:` block in `.github/workflows/ci.yml`. CI has no `.env.test`, so an env var added to only one of the two passes locally and fails on the PR.

Repointing a provider URL env var (a `*_API_BASE_URL`, an OAuth authorize/token URL) reroutes every existing spec whose journey touches that provider, not just yours. When QuickBooks' authorize URL moved from Intuit's domain to the in-app stand-in, a merged spec that stubbed off-origin traffic and waited to leave the origin started timing out — its journey now never leaves. Before repointing, grep `tests/` for specs driving that provider and rework any that assume the old destination.

### Overlay clicks

Inside fixed-position overlay containers (modals, drawers, side panels), a click on an element below the overlay's visible fold can silently no-op instead of auto-scrolling it into view — in Playwright-driven browsers and agent-browser alike. The same applies to ordinary page scroll: a submit button far below the fold of a small viewport can no-op the same way. Scroll the container (or page) first, then click. When a click "does nothing" during manual verification, reproduce with a user-style scroll-and-tap before concluding the control is broken; the silent no-op is a harness artifact, not a product bug.

A second agent-browser artifact: when an action changes the target's accessible name (a toggle whose `aria-label` flips between "Add X" and "Remove X"), `check`/`uncheck` report "Element not found" AFTER succeeding — the tool re-locates the element by its old name to confirm. Verify the state change instead of trusting the error.

For complete E2E spec and seed-flow examples, see [references/examples.md](references/examples.md#e2e-testing).
