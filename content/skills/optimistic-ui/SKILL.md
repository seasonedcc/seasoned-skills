---
name: optimistic-ui
description: Build optimistic UI with React Router v7 using deterministic resource routes. Use when implementing toggles, optimistic updates, action-only routes, or when user mentions optimistic UI, toggle, or real-time feedback.
---

# Optimistic UI

Build optimistic UI that is resilient to rapid user interactions and race conditions. The key insight is **deterministic resource routes** — endpoints that declare their intended end state. Combined with `useSubmit`, `useFetchers`, and `?respond-with-json`, this pattern makes optimistic state trivially derivable.

## Core Principles

1. **Deterministic resource routes** — each request declares its intended end state, never toggles
2. **`useSubmit` with `navigate: false`** — simpler than `useFetcher()`, no instance wiring needed
3. **`useFetchers` (plural)** — reads all in-flight fetcher states for optimistic computation
4. **`?respond-with-json`** — prevents `act()` from redirecting on success

## Why Deterministic Routes

A non-deterministic endpoint like `/toggle-thing` creates race conditions:

- Calling it twice flips the state back — out-of-order requests produce unpredictable server state
- Optimistic state is ambiguous: a pending request to `/toggle-thing` doesn't tell you what the intended state is

Deterministic endpoints solve this in two ways:

**Separate endpoints** (an addition endpoint and a removal endpoint — under an append-only schema they append opposite events; see the database-design skill):
- Each action has a distinct URL, making optimistic state trivially derivable from `formAction`
- Each request is idempotent — calling the addition endpoint twice still results in "selected"

**Single endpoint with declarative payload** (e.g. `/items/:itemId/update-active` with `{ active: true }`):
- Each item's URL is unique, so requests to different items don't interfere
- Optimistic state is derivable from `formAction` + `formData`

## Why `useSubmit` over `useFetcher`

Both work with deterministic routes. Prefer `useSubmit` + `useFetchers()` for simplicity:
- No need to create and wire a fetcher instance
- `useFetchers()` derives optimistic state from anywhere without prop drilling
- Cleaner separation between submission and state derivation

Use `useFetcher()` when a row needs its own pending/error state (disable just that row's control, anchor its error).

## State discipline

The router already keeps every request's lifecycle. In React Router v7, component state — `useState`, `useRef`, `useContext` — is for UI-only concerns: an open menu, an editing flag, a typed-but-refused value held for display. Anything that issues requests or tracks them through component state re-derives what the router owns: pending state is the in-flight fetcher (`useFetchers`, `fetcher.state`), the result is `fetcher.data`, and reconciliation is revalidation. Code that fires requests out of `useState`/`useEffect`, keeps its own pending map, or hand-rolls revalidation is re-implementing the router, and it is wrong here even when it works. Nearly all `useContext` in route components is the same smell — loader data, params, and fetchers cover what it usually reaches for.

Do not serialize writes to defend against server-order races. Parallel submissions can land out of order; that is the nature of parallel browser work, and revalidation reconciles the page to the server's truth afterward. Serializing one affordance's requests buys precision on a rare edge case at the cost of managing every affordance's side effects by hand — which is exactly the job revalidation already does.

Route discovery stays lazy. The router ships only the current page's manifest and discovers rendered links in one batched request — the fog-of-war default, which exists because full manifests scale badly (a 1,300-route app measured ~10MB of manifest uncompressed). `routeDiscovery: 'initial'` is never the fix for an edge this creates. The one known residual is accepted: a submit made offline to a write route the browser has never visited reaches the error boundary, because the route's chunk cannot load without a network. If that corner ever earns a fix, it is scoped to the edge — discovery triggered for an editing surface's write routes — never the whole product's manifest.

## Keying rows that are edited in place

This bites wherever a write re-mints row identity. Under an append-only schema, saving one field appends a whole new revision, and a revision is a snapshot: it re-inserts every child row under brand-new ids. A cell's commit is a fetcher submission and the router revalidates after it, so those new ids land on the page a moment after each save — routinely after the person has already opened the next cell.

A list keyed on a re-minted id therefore remounts every row mid-typing. An open cell keeps "am I being typed into" in its own state, and a rebuilt row starts closed, so the input leaves the page mid-word taking the typed words and the cursor with it, silently. To the person, the save they just made ate the sentence they were writing.

Key an editable row by the stable identity its own write route addresses — never a revision-minted id, never a mutable field like a name:

- a child row's sequence or display order, addressed by `…/steps/:sequenceOrder` or `…/items/:displayOrder`
- the write address itself, when a row's address varies by surface — the key is the URL the row's edits submit to
- a root identity table's id where one exists — stable because its revisions hang off it

When the display order a write route addresses is not already on the row, carry it from the query rather than inferring it from the row's position in the array.

Guard every such list with a cheap negative control: render the room, open a cell, type into it, then land a revalidation whose loader hands the same rows back under new ids, and assert the input node is the same one, still holding the typed words, still focused. Restoring the old key must fail it. A `useRevalidator()` button in a `createRoutesStub` parent lands the reload on demand, so the guard needs no timing — name it something like "keeps the words and the cursor when the list reloads". Reproducing the loss in a browser instead means holding every reload back by seconds to land it inside someone's typing, which is why the guard lives in a unit test.

## Pattern: per-row toggle with two endpoints

For toggling a boolean on a row by hitting two separate endpoints (one to create the association, one to destroy it) — selecting options on a record, say.

### 1. Action-only routes

Create two action-only route files (`.ts`, no component export). Register them in `app/routes.ts`.

```typescript
route(
  'records/:recordId/options/create',
  'routes/records/options/create.ts',
),
route(
  'records/:recordId/options/:optionId/destroy',
  'routes/records/options/destroy.ts',
),
```

Each action calls `act(...)` with the appropriate business function and schema:

```typescript
import { act } from '~/framework/controllers.server'
import { getUserContext } from '~/business/auth.server'
import { createRecordOption } from '~/business/records.server'

export async function action({ request, params }: Route.ActionArgs) {
  const context = await getUserContext(request, params)

  return act(createRecordOption)({
    schema: createRecordOptionSchema,
    request,
    params,
    context,
  })
}
```

### 2. Optimistic hook with `useFetcher`

For per-row toggles where each row owns its own fetcher, derive optimistic state from `fetcher.formAction`:

```typescript
const fetcher = useFetcher()

const isCreating = fetcher.formAction?.includes('/options/create')
const isDestroying = fetcher.formAction?.includes('/destroy')

const optimisticSelected = isCreating ? true : isDestroying ? false : isSelected
```

### 3. Toggle UI

```typescript
const handleToggle = () => {
  if (optimisticSelected) {
    fetcher.submit(
      {},
      {
        action: `${href('/records/:recordId/options/:optionId/destroy', { recordId, optionId: option.id })}?respond-with-json`,
        method: 'post',
      },
    )
  } else {
    fetcher.submit(
      { optionId: option.id },
      {
        action: `${href('/records/:recordId/options/create', { recordId })}?respond-with-json`,
        method: 'post',
      },
    )
  }
}
```

Key details:
- `fetcher.submit(...)` keeps the submission scoped to the row's own fetcher state, which is what the optimistic hook reads
- `?respond-with-json` — tells `act()` to return data instead of redirecting (see `app/framework/controllers/act.server.ts`)

### Singleton variant with `useSubmit` + `useFetchers`

When the toggle is a single global setting (not per-row), use `useSubmit()` for submissions and `useFetchers()` to read all in-flight fetchers and derive optimistic state from their `formAction`:

```typescript
function useOptimisticToggle(serverValue: boolean) {
  const fetchers = useFetchers()

  let optimistic = serverValue
  for (const fetcher of fetchers) {
    if (fetcher.formAction?.includes('/enable')) optimistic = true
    else if (fetcher.formAction?.includes('/disable')) optimistic = false
  }
  return optimistic
}
```

The loop iterates all fetchers — the last matching one wins, which naturally reflects the most recent user action, so rapid toggling stays consistent. Pair with `submit(null, { action, method: 'post', navigate: false })` from `useSubmit()`.

## Pattern: per-item toggle (list of items)

For toggling a boolean on items in a list. Each item has a unique ID in the action URL.

### 1. Action-only route

A single route with an ID param that accepts the new value:

```typescript
// app/routes/items/update-active.ts
export async function action({ request, params }: Route.ActionArgs) {
  const context = await getUserContext(request, params)

  return act(updateItemActive)({
    schema: updateItemActiveSchema,
    request,
    params,
    context,
  })
}
```

With per-item toggles, each item's URL is unique (e.g., `/items/123/update-active` vs `/items/456/update-active`), so a single endpoint is acceptable — the payload (`{ active: true }`) makes each request deterministic.

### 2. Optimistic hook with Map

Use a `Map<string, boolean>` to track optimistic state per item:

```typescript
function useOptimisticItems(items: Array<{ id: string; active: boolean /* ... */ }>) {
  const fetchers = useFetchers()

  const activeUpdates = new Map<string, boolean>(
    fetchers
      .filter((f) => f.formAction?.includes('/update-active') && f.formData)
      .map((f) => {
        const match = f.formAction?.match(/\/items\/([^/]+)\/update-active/)
        const id = match?.[1]
        const active = f.formData?.get('active') === 'true'
        return id ? ([id, active] as const) : null
      })
      .filter((entry): entry is [string, boolean] => entry !== null),
  )

  return items.map((item) => ({
    ...item,
    active: activeUpdates.get(item.id) ?? item.active,
  }))
}
```

### 3. Toggle UI with `useSubmit`

```typescript
const submit = useSubmit()

<input
  type="checkbox"
  checked={item.active}
  onChange={() => {
    submit(
      { active: String(!item.active) },
      {
        action: `${href('/items/:itemId/update-active', { itemId: item.id })}?respond-with-json`,
        method: 'post',
        navigate: false,
      },
    )
  }}
/>
```

## Checklist

When implementing optimistic UI:

- [ ] Design deterministic resource routes (separate endpoints or declarative payload)
- [ ] Create action-only route files (`.ts`, no component)
- [ ] Register routes in `app/routes.ts`
- [ ] Use `act()` in actions
- [ ] Use `useSubmit()` for submissions (or `useFetcher()` when the row needs its own pending/error state)
- [ ] Pass `navigate: false` to `submit()`
- [ ] Append `?respond-with-json` to the action URL
- [ ] Create a `useOptimistic*` hook using `useFetchers()`
- [ ] Derive optimistic state from `formAction` (singleton) or `formAction` + `formData` (per-item)
- [ ] Use `href()` from `react-router` for type-safe route URLs
- [ ] Key rows edited in place by the identity their write route addresses, and guard each list with a test that lands a revalidation into an open cell
