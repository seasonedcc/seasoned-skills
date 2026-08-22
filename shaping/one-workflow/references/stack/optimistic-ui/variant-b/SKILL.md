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

**Separate endpoints** (an addition endpoint and a removal endpoint — in the append-only schema they append opposite events; see the database-design skill):
- Each action has a distinct URL, making optimistic state trivially derivable from `formAction`
- Each request is idempotent — calling the addition endpoint twice still results in "selected"

**Single endpoint with declarative payload** (e.g. `/members/:userId/apply` with `{ assigned: true }`):
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

The schema is append-only, so saving one field appends a whole new revision, and a revision is a snapshot: it re-inserts every child row under brand-new ids — appending a recipe revision re-inserts its control points, quality checks, steps and step media (`app/business/recipes.server.ts`). A cell's commit is a fetcher submission and the router revalidates after it, so those new ids land on the page a moment after each save — routinely after the person has already opened the next cell.

A list keyed on a re-minted id therefore remounts every row mid-typing. An open cell keeps "am I being typed into" in its own state (`app/ui/editable-value.tsx`), and a rebuilt row starts closed, so the input leaves the page mid-word taking the typed words and the cursor with it, silently. To the person, the save they just made ate the sentence they were writing.

Key an editable row by the stable identity its own write route addresses — never a revision-minted id, never a mutable field like a name:

- a step's sequence order, addressed by `…/steps/:sequenceOrder` (`app/routes/app/production/recipes/steps.tsx:289`)
- a control point's, quality check's or link's display order, addressed by `…/control-points/:displayOrder` and its siblings (`app/routes/app/production/recipes/product-specs/food-safety.tsx:174`, `:220`, `:364`)
- a packaging group's display order, addressed by `…/packaging-groups/:displayOrder` (`app/routes/app/production/recipes/run-configuration.tsx:319`)
- the write address itself, when a row's address varies by surface: the media gallery keys on `itemAction(item, position, 'rename')` (`app/ui/media-gallery.tsx:341`), which resolves to `…/media/:displayOrder/rename` beside a recipe or a step and `…/spec-media/:mediaId/rename` beside a product
- a root identity table's id where one exists — `companyCountLevels.id` and `companyLanguages.id` are stable because their revisions hang off them (`app/routes/app/companies/count-levels.tsx:58`, `app/routes/app/companies/languages.tsx:58`)

When the display order a write route addresses is not already on the row, carry it from the query rather than inferring it from the row's position in the array.

Guard every such list with a cheap negative control: render the room, open a cell, type into it, then land a revalidation whose loader hands the same rows back under new ids, and assert the input node is the same one, still holding the typed words, still focused. Restoring the old key must fail it. A `useRevalidator()` button in a `createRoutesStub` parent lands the reload on demand, so the guard needs no timing — see `steps.test.tsx` ("keeps the words and the cursor when a step reloads"), `product-specs/food-safety.test.tsx` and `run-configuration.test.tsx`. Reproducing the loss in a browser instead means holding every reload back by seconds to land it inside someone's typing, which is why the guard lives in a unit test.

## The worked example: department members

`app/routes/app/companies/departments/members.tsx` is the reference implementation of the declarative-payload pattern — a modal that assigns users to a department with instant feedback.

The action-only route (`apply-member.ts`, registered in `app/routes.ts` as `companies/departments/:departmentId/members/:userId/apply`) calls `act(...)` with the business function; the payload's `assigned` field declares the end state.

The optimistic hook folds every in-flight fetcher into the server state:

```typescript
function useOptimisticMembers(departmentId: string, memberUserIds: string[]) {
  const fetchers = useFetchers()
  const assigned = new Set(memberUserIds)
  const pattern = new RegExp(
    `/departments/${departmentId}/members/([^/?]+)/apply`
  )

  for (const fetcher of fetchers) {
    if (!fetcher.formAction || !fetcher.formData) continue

    const userId = fetcher.formAction.match(pattern)?.[1]
    if (!userId) continue

    if (fetcher.formData.get('assigned') === 'true') assigned.add(userId)
    else assigned.delete(userId)
  }

  return assigned
}
```

The submission declares the end state and opts out of navigation via `?respond-with-json`:

```typescript
const toggle = (userId: string, next: boolean) =>
  fetcher.submit(
    { assigned: String(next), userId },
    {
      action: `${href('/app/companies/departments/:departmentId/members/:userId/apply', { departmentId: department.id, userId })}?respond-with-json`,
      method: 'post',
    }
  )
```

Iterating all fetchers means the last matching one wins, which naturally reflects the most recent user action — rapid toggling stays consistent.

### Singleton variant

When the toggle is a single global setting (not per-item), the same shape collapses to `formAction` alone:

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

Pair with `submit(null, { action, method: 'post', navigate: false })` from `useSubmit()`.

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

## References

- Per-item declarative-payload toggle: `app/routes/app/companies/departments/members.tsx` (+ `apply-member.ts`)
- Fetcher-per-cell in-place editing — per-cell `useFetcher` keys, `useFetchers` pending derivation, refusal and unreached-server handling: `app/ui/editable-value.tsx` (+ `app/framework/controllers/unreached.ts`)
- Row keys that survive a revision: `app/routes/app/production/recipes/steps.tsx`, `app/routes/app/production/recipes/product-specs/food-safety.tsx`, `app/ui/media-gallery.tsx` (+ the `keeps the words and the cursor` tests beside them)
- More `useFetchers` derivations: `app/routes/app/staff-schedule.tsx`, `app/routes/app/purchase-orders/index.tsx`
- `act()` with `?respond-with-json`: `app/framework/controllers/act.server.ts`
