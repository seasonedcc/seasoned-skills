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
  { value: 'obs-hemoglobin', label: 'Hemoglobina', secondaryLabel: 'Sangue' },
  { value: 'obs-glucose', label: 'Glicose', secondaryLabel: 'Sangue' },
]

describe('PoolAutocomplete', () => {
  it('shows matching items when typing a label fragment', () => {
    render(
      <PoolAutocomplete name="observationId" items={items} onChange={vi.fn()} />
    )

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'hemo' },
    })

    screen.getByText('Hemoglobina')
    expect(screen.queryByText('Glicose')).toBeNull()
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
    const email = `${crypto.randomUUID()}@test.ca`
    await sendAuthEmail.run({ email, url: 'https://example.com/signin' }, {} as any)

    expect(mockedSendEmail).toHaveBeenCalledOnce()
  })
})
```

### Example: Manual Database Setup with Random IDs

When helper functions aren't available:

```typescript
describe('fetchSomething', () => {
  it('returns the inserted record', async () => {
    const id = crypto.randomUUID()

    await db()
      .insertInto('customers')
      .values({
        id,
        fullName: `Test ${id}`,
        cpf: '00000000000',
        birthDate: '2000-01-01',
        sexAtBirth: 'female',
      })
      .execute()

    const result = await fetchSomething({ customerId: id })

    expect(result.fullName).toBe(`Test ${id}`)
  })
})
```

**Key patterns:**
- Use `crypto.randomUUID()` for unique identifiers
- Use helpers from `~/test/prelude` when available
- Query by the random identifiers, never assume existing data
- No cleanup needed — tests run in parallel with isolated data
- Assert on specific behavior and outcomes

For richer business-test examples, see also `app/business/appointments.server.test.ts` and `app/business/results.server.test.ts`.

## E2E Testing

E2E specs drive the real app in a browser. They adopt a seeded persona, read everything
they need from fixtures, and select elements by the pt-BR copy a user sees.

### Example: A read-only journey

From `tests/care-home-opens-a-published-result.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'
import { fixtures } from './helpers'
import { storageStatePath } from './paths'

test.use({ storageState: storageStatePath('e2e-care-results') })

test('the care home opens a concluded result and every observation behind it', async ({
  page,
}) => {
  const { results } = fixtures().care

  await page.goto('/care/home')

  await expect(
    page.getByRole('heading', { name: 'Concluídos · 1' })
  ).toBeVisible()
  await expect(page.getByText(results.procedureDate)).toBeVisible()

  await page.getByRole('link', { name: 'Ver resultados' }).click()

  await expect(page).toHaveURL(`/care/results/${results.resultId}`)
  await expect(
    page.getByRole('heading', { name: results.protocolName, level: 1 })
  ).toBeVisible()
})
```

Every literal that describes *data* comes from `fixtures()`; every literal that
describes *copy* is the real interface text, so a rename fails the spec on purpose.

### Example: A mutating journey that survives a retry

From `tests/venue-visits-check-in-starts-a-clients-visit.spec.ts`. Checking a client in
is irreversible, so the seed reserves a pool of identical visits and each attempt spends
exactly one — a retry never finds the visit the dead attempt consumed:

```typescript
test('checking a client in starts their visit', async ({ page }, testInfo) => {
  const { venueId, checkIn } = fixtures().venueVisits
  const visit = reservedVisit(checkIn, testInfo)

  await openVisitsBoard(page, venueId)

  const waiting = await showOnlyVisit(page, visit.customerName)
  await waiting.getByRole('link', { name: 'Check-in', exact: true }).click()

  const drawer = page.getByRole('dialog', { name: 'Check-in' })
  await drawer.getByRole('button', { name: 'Confirmar check-in' }).click()

  await expect(page).toHaveURL(visitsUrl(venueId))

  const live = await showOnlyVisit(page, visit.customerName)
  await expect(visitGroupHeading(page, 'live')).toBeVisible()
})
```

`openVisitsBoard` waits for the client router to hydrate before anything is clicked, and
`showOnlyVisit` filters the board down to one row so no assertion depends on how many
other visits the shared venue holds.

### Example: A seed flow

From `tests/seed/flows/oauthTokens.ts` — the smallest complete flow module:

```typescript
import type { SeedContext } from '../context'

const namespaces = ['e2e-oauth']

const AGENT = {
  email: 'e2e-oauth-agent@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
}

async function seed(context: SeedContext) {
  const user = await context.findOrCreateUser(AGENT)

  await context.mintStorageState(user.id, 'e2e-oauth-agent')

  return { userId: user.id, email: user.email }
}

export { namespaces, seed }
```

`namespaces` reserves the identifier prefixes this flow owns; the returned object lands
in `fixtures().oauthTokens`; `mintStorageState` writes the session the spec adopts with
`storageStatePath('e2e-oauth-agent')`.

### Example: A mobile spec

From `tests/care-home-opens-a-published-result-on-a-phone.mobile.spec.ts`. Files ending
in `.mobile.spec.ts` run on a Pixel 7 and assert what a phone changes — here the desktop
sidebar is gone and the bottom dock carries navigation:

```typescript
await expect(page.getByRole('link', { name: 'Manual do usuário' })).toHaveCount(0)
await page.getByRole('link', { name: 'Plano', exact: true }).click({ trial: true })
await expectFitsTheViewport(page)
```

## Summary

**Unit Tests:**
- Use `createRoutesStub` instead of mocking React Router
- Insert data with random identifiers, never delete
- Test behavior and accessibility, not implementation
- Group tests by subject with descriptive names

**E2E Tests:**
- One test per file, named after the behavior
- Adopt a seeded persona; never sign in unless authentication is the subject
- Read data from `fixtures()`, never from the database or `process.env`
- Build before running, and keep every route covered by the gate
