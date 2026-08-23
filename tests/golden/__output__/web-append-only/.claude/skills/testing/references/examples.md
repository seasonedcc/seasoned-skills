# Testing Examples

Concrete examples demonstrating testing patterns used in the app.

## Table of Contents

- [Component Testing](#component-testing)
- [React Router Testing with createRoutesStub](#react-router-testing-with-createroutesstub)
- [Database Testing with Random Identifiers](#database-testing-with-random-identifiers)
- [E2E Testing](#e2e-testing)

## Component Testing

For components that don't depend on React Router, use `@testing-library/react` directly with the `// @vitest-environment jsdom` directive at the top of the file.

### Example: Testing a UI Component

From `app/ui/pool-autocomplete.test.tsx`:

```typescript
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PoolAutocomplete } from './pool-autocomplete'

afterEach(() => {
  cleanup()
})

const items = [
  { value: 'prod-flour', label: 'Bread Flour', secondaryLabel: 'Raw material' },
  { value: 'prod-sugar', label: 'Cane Sugar', secondaryLabel: 'Raw material' },
]

describe('PoolAutocomplete', () => {
  it('shows matching items when typing a label fragment', () => {
    render(
      <PoolAutocomplete name="productId" items={items} onChange={vi.fn()} />
    )

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'flour' },
    })

    screen.getByText('Bread Flour')
    expect(screen.queryByText('Cane Sugar')).toBeNull()
  })
})
```

**Key patterns:**
- `// @vitest-environment jsdom` directive enables DOM testing
- `cleanup()` after each test
- Query by accessibility (`getByRole`, `getByPlaceholderText`)
- Use `fireEvent` for interactions

## React Router Testing with createRoutesStub

For components that depend on React Router (using `Link`, `useNavigate`, `useLocation`, etc.), use `createRoutesStub` instead of mocking the router.

### Example: Testing Component Rendering with Routes

```typescript
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { SomeComponent } from './some-component'

afterEach(() => {
  cleanup()
})

describe('SomeComponent', () => {
  it('renders a link to the detail page', () => {
    const Stub = createRoutesStub([
      {
        path: '/items',
        Component: () => <SomeComponent itemId="abc" />,
      },
    ])

    render(<Stub initialEntries={['/items']} />)

    const link = screen.getByRole('link', { name: /view item/i })
    expect(link.getAttribute('href')).toBe('/items/abc')
  })
})
```

### Example: Testing Navigation State

Testing that navigation passes state correctly:

```typescript
import { fireEvent } from '@testing-library/react'
import { useLocation } from 'react-router'

it('passes state when navigating', async () => {
  const LocationViewer = () => {
    const location = useLocation()
    return <pre data-testid="state">{JSON.stringify(location.state)}</pre>
  }

  const Stub = createRoutesStub([
    { path: '/items', Component: () => <SomeComponent itemId="abc" /> },
    { path: '/items/:itemId', Component: LocationViewer },
  ])

  render(<Stub initialEntries={['/items']} />)
  fireEvent.click(screen.getByRole('link', { name: /view item/i }))

  expect(screen.getByTestId('state').textContent).toBe(
    JSON.stringify({ from: 'items' })
  )
})
```

**Key patterns:**
- Use `createRoutesStub` with route configuration
- Render with `initialEntries` to set starting location
- Query by accessibility attributes (roles, labels)
- Test behavior, not implementation details

## Database Testing with Random Identifiers

Never delete database records in tests. Use random identifiers to ensure test isolation.

### Example: Server-side Business Function Test

From `app/business/auth.server.test.ts`:

```typescript
import { fromSuccess } from 'composable-functions'
import { afterEach, vi } from 'vitest'
import { sendEmail } from '~/email.server'
import { db, describe, expect, it } from '~/test/prelude'
import { sendAuthEmail } from './auth.server'

vi.mock('~/email.server', async () => {
  const actual =
    await vi.importActual<typeof import('~/email.server')>('~/email.server')
  return { ...actual, sendEmail: vi.fn() }
})

const mockedSendEmail = vi.mocked(sendEmail)

afterEach(() => {
  mockedSendEmail.mockClear()
})

describe('sendAuthEmail', () => {
  it('enqueues an auth email job', async () => {
    const email = `${crypto.randomUUID()}@test.example.com`
    await sendAuthEmail.run({ email, url: 'https://example.com/signin' }, {} as any)

    expect(mockedSendEmail).toHaveBeenCalledOnce()
  })
})
```

### Example: Manual Database Setup with Random IDs

When helper functions aren't available:

```typescript
describe('fetchCurrentProduct', () => {
  it('returns the latest revision', async () => {
    const id = crypto.randomUUID()

    await db()
      .insertInto('products')
      .values({ id, companyId })
      .execute()
    await db()
      .insertInto('productRevisions')
      .values({ productId: id, name: `Test ${id}`, sku: `SKU-${id}`, unitId })
      .execute()

    const result = await fetchCurrentProduct({ productId: id })

    expect(result.name).toBe(`Test ${id}`)
  })
})
```

**Key patterns:**
- Use `crypto.randomUUID()` for unique identifiers
- Use helpers from `~/test/prelude` when available
- Query by the random identifiers, never assume existing data
- No cleanup needed — tests run in parallel with isolated data
- Assert on specific behavior and outcomes

## E2E Testing

E2E specs drive complete user journeys through the built app in a real browser. Each file holds exactly one `test()`, and the filename is the behavior sentence in kebab-case. `test` and `expect` come from `tests/harness.ts`, which gives the spec the app stack its worker runs and the `baseURL` that reaches it.

### Example: a signed-out spec

From `tests/landing.spec.ts` — no `test.use()`, so the spec runs signed out:

```typescript
import { expect, test } from './harness'

test('landing page displays title', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/The App/)
})
```

### Example: adopting a persona

A spec signs in by adopting one of the `storageState` files the seed mints into `tests/.auth/`. There is no default — declaring nothing means signed out.

From `tests/receiving-calendar.spec.ts`, trimmed:

```typescript
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './harness'

const fixtures = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'tests', '.auth', 'fixtures.json'),
    'utf8'
  )
) as {
  dates: { approvedMonthLabel: string }
  receiving: { approvedPoId: string; pendingPoId: string }
}

test.use({ storageState: 'tests/.auth/state.json' })

test('receiving calendar shows delivery chips and a read-only day lens', async ({
  page,
}) => {
  await page.goto('/app/inventory/receiving')

  await expect(
    page.getByRole('heading', { name: 'Receiving', level: 1 })
  ).toBeVisible()
  await expect(page.getByText(fixtures.dates.approvedMonthLabel)).toBeVisible()

  await expect(
    page.locator(`a[href*="/receiving/${fixtures.receiving.pendingPoId}"]`)
  ).toHaveCount(0)
})
```

**What this file demonstrates:**
- Fixtures come from `tests/.auth/fixtures.json`, nested under the seeding flow's stem — never from the database and never from `process.env`.
- The month label is the string the seed formatted in SQL. Restating it in the spec is how seed and spec drift apart.
- Absence is `toHaveCount(0)`.

### Example: a table-driven spec over one behavior

One behavior can span many URLs and still be one test. From `tests/auth-guard-redirects-every-protected-area.spec.ts`:

```typescript
import { expect, test } from './harness'

const protectedAreas = [
  '/app/purchase-orders',
  '/app/sales-orders',
  // …
]

test('the auth guard sends a signed-out visitor from every protected area to sign-in', async ({
  page,
}) => {
  for (const area of protectedAreas) {
    await page.goto(area)

    await expect(page).toHaveURL(/\/auth/)
  }
})
```

Every URL in the table still reaches its route, so the coverage gate counts each one. Splitting the same assertion across one file per URL buys nothing and costs a browser context each.

### Pattern: retry safety through a convergent prologue

CI retries a failed spec against whatever the dead attempt left behind. A spec that spends state builds that state first. From `tests/receiving-actions.spec.ts`:

```typescript
async function createReceivablePurchaseOrder(page: Page) {
  const deliveryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  await page.goto('/app/purchase-orders/new')
  await page.getByLabel('Expected delivery date').fill(deliveryDate)
  // … add a product, create, approve …

  return new URL(page.url()).pathname.split('/').pop() ?? ''
}

test('receive, QC-approve, put away, then inspect and label a receipt', async ({
  page,
}) => {
  const purchaseOrderId = await createReceivablePurchaseOrder(page)
  // … the journey under test, against an order this attempt owns
})
```

The delivery date is computed relative to today, never hardcoded.

### Pattern: retry safety through a seeded pool

When the prologue would be prohibitively long, the seed provides one slot per attempt and the spec indexes by `testInfo.retry`. From `tests/receiving-receive-drawer.spec.ts`:

```typescript
test('receives a line through the receive drawer …', async ({ page }, testInfo) => {
  const purchaseOrderId = fixtures.receiving.receiveDrawerPoIds[testInfo.retry]
  // …
})
```

`SLOT_COUNT` in `tests/seed/flows/receiving.ts` is 1 + the CI retry count.

### Pattern: a seed flow module

A file in `tests/seed/flows/` exports `namespaces`, `companies`, and `seed`. Its return value lands under its filename stem, and filename order is dependency order. From `tests/seed/flows/account.ts`:

```typescript
const ACCOUNT = { email: 'dev@example.test', firstName: 'Dev', lastName: 'User' }
const EXAMPLE_FOODS = 'Example Foods'

const namespaces = [ACCOUNT.email, EXAMPLE_FOODS]
const companies = [EXAMPLE_FOODS]

async function seed(context: SeedContext) {
  const userId = await ensureUser(context.database, ACCOUNT)

  const keys = await context.database.transaction().execute(async (trx) => {
    const company = await ensureOrganizationCompany(trx, {
      organizationName: EXAMPLE_FOODS,
      companyName: EXAMPLE_FOODS,
      companyCode: 'EXF_1',
    })

    await ensureActiveMembership(trx, company.companyId, userId)
    await seedAdministratorRoleForOrganization(trx, company.organizationId)

    return company
  })

  await context.mintStorageState('state', { userId, companyId: keys.companyId })

  return { email: ACCOUNT.email, userId, ...keys }
}

export { companies, namespaces, seed }
```

Every write is an `ensure*` — find-or-create on a stable natural key. The flow seeds its own Administrator role rather than assuming another flow did, and mints its own persona.

### Pattern: convergence in the append-only style

A convergent helper derives the current state and appends the correcting event only when it differs. From `tests/seed/provisioning.ts`:

```typescript
async function ensureRoleRemoved(trx: Executor, roleId: string, userId: string) {
  if (!(await holdsRole(trx, roleId, userId))) return

  await trx.insertInto('roleRemovals').values({ roleId, userId }).execute()
}
```

A blind insert here would append one removal event per run, forever.

### Example: a mobile spec

Files ending in `.mobile.spec.ts` run under the mobile project's phone profile and assert what a phone changes — here the desktop sidebar is gone and the bottom dock carries navigation:

```typescript
await expect(page.getByRole('link', { name: 'User manual' })).toHaveCount(0)
await page.getByRole('link', { name: 'Plan', exact: true }).click({ trial: true })
```

`click({ trial: true })` runs Playwright's full actionability check without firing the action, proving the control is tappable; pair it with an assertion that the page does not scroll sideways.

## Summary

**Unit Tests:**
- Use `createRoutesStub` instead of mocking React Router
- Insert data with random identifiers, never delete
- Test behavior and accessibility, not implementation
- Group tests by subject with descriptive names

**E2E Tests:**
- One `test()` per file; the filename is the behavior sentence
- No default persona — a spec without `test.use({ storageState })` runs signed out
- Build before running; `test` and `expect` come from `./harness`, which runs the worker's app stack
- Never touch the database or `process.env` from a spec — fixtures and `baseURL` only
- Every route the journey touches must reach the coverage gate as covered
