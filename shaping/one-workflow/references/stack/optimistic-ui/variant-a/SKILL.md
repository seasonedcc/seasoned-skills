---
name: optimistic-ui
description: Build optimistic UI with React Router using deterministic resource routes. Use when implementing toggles, optimistic updates, action-only routes, or when user mentions optimistic UI, toggle, or real-time feedback.
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

**Separate endpoints** (e.g., `/observations/create` and `/observations/:id/destroy`):
- Each action has a distinct URL, making optimistic state trivially derivable from `formAction`
- Each request is idempotent — calling the create endpoint twice still results in "selected"

**Single endpoint with declarative payload** (`/update-active` with `{ active: true }`):
- Each item's URL is unique (e.g., `/analyses/123/update-active`), so requests don't interfere
- Optimistic state is derivable from `formAction` + `formData`

## Why `useSubmit` over `useFetcher`

Both work with deterministic routes. Prefer `useSubmit` + `useFetchers()` for simplicity:
- No need to create and wire a fetcher instance
- `useFetchers()` derives optimistic state from anywhere without prop drilling
- Cleaner separation between submission and state derivation

## Pattern: Per-Row Toggle with Two Endpoints

For toggling a boolean on a row by hitting two separate endpoints (one to create the association, one to destroy it). The app uses this for selecting observations on an analysis step (`app/routes/lab/analysis-step-drawer.tsx`).

### 1. Action-Only Routes

Create two action-only route files (`.ts`, no component export). Register them in `app/routes.ts`.

```typescript
route(
  'lab/analyses/:analysisId/steps/:stepId/observations/create',
  'routes/lab/analyses/steps/observations/create.ts',
),
route(
  'lab/analyses/:analysisId/steps/:stepId/observations/:observationId/destroy',
  'routes/lab/analyses/steps/observations/destroy.ts',
),
```

Each action calls `act(...)` with the appropriate business function and schema:

```typescript
import { act } from '~/framework/controllers.server'
import { getAdminContext } from '~/business/auth.server'
import { createStepObservation } from '~/business/analyses.server'

export async function action({ request, params }: Route.ActionArgs) {
  const context = await getAdminContext(request, params)

  return act(createStepObservation)({
    schema: createStepObservationSchema,
    request,
    params,
    context,
  })
}
```

### 2. Optimistic Hook with `useFetcher`

For per-row toggles where each row owns its own fetcher, derive optimistic state from `fetcher.formAction`:

```typescript
const fetcher = useFetcher()

const isCreating = fetcher.formAction?.includes('/observations/create')
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
        action: `${href('/lab/analyses/:analysisId/steps/:stepId/observations/:observationId/destroy', { analysisId, stepId, observationId: observation.id })}?respond-with-json`,
        method: 'post',
      },
    )
  } else {
    fetcher.submit(
      { observationId: observation.id },
      {
        action: `${href('/lab/analyses/:analysisId/steps/:stepId/observations/create', { analysisId, stepId })}?respond-with-json`,
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

The loop iterates all fetchers — the last matching one wins, which naturally reflects the most recent user action. Pair with `submit(null, { action, method: 'post', navigate: false })` from `useSubmit()`.

## Pattern: Per-Item Toggle (List of Items)

For toggling a boolean on items in a list. Each item has a unique ID in the action URL.

### 1. Action-Only Route

A single route with an ID param that accepts the new value:

```typescript
// app/routes/lab/analyses/update-active.ts
export async function action({ request, params }: Route.ActionArgs) {
  const context = await getAdminContext(request, params)

  return act(updateAnalysisActive)({
    schema: updateAnalysisActiveSchema,
    request,
    params,
    context,
  })
}
```

With per-item toggles, each item's URL is unique (e.g., `/analyses/123/update-active` vs `/analyses/456/update-active`), so a single endpoint is acceptable — the payload (`{ active: true }`) makes each request deterministic.

### 2. Optimistic Hook with Map

Use a `Map<string, boolean>` to track optimistic state per item:

```typescript
function useOptimisticAnalyses(analyses: Array<{ id: string; active: boolean; /* ... */ }>) {
  const fetchers = useFetchers()

  const activeUpdates = new Map<string, boolean>(
    fetchers
      .filter((f) => f.formAction?.includes('/update-active') && f.formData)
      .map((f) => {
        const match = f.formAction?.match(/\/analyses\/([^/]+)\/update-active/)
        const id = match?.[1]
        const active = f.formData?.get('active') === 'true'
        return id ? ([id, active] as const) : null
      })
      .filter((entry): entry is [string, boolean] => entry !== null),
  )

  return analyses.map((analysis) => ({
    ...analysis,
    active: activeUpdates.get(analysis.id) ?? analysis.active,
  }))
}
```

### 3. Toggle UI with `useSubmit`

```typescript
const submit = useSubmit()

<input
  type="checkbox"
  className="toggle toggle-sm toggle-primary"
  checked={analysis.active}
  onChange={() => {
    submit(
      { active: String(!analysis.active) },
      {
        action: `${href('/lab/analyses/:analysisId/update-active', {
          analysisId: analysis.id,
        })}?respond-with-json`,
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
- [ ] Use `useSubmit()` for submissions
- [ ] Pass `navigate: false` to `submit()`
- [ ] Append `?respond-with-json` to the action URL
- [ ] Create a `useOptimistic*` hook using `useFetchers()`
- [ ] Derive optimistic state from `formAction` (singleton) or `formAction` + `formData` (per-item)
- [ ] Use `href()` from `react-router` for type-safe route URLs

## References

- Per-row two-endpoint toggle: `app/routes/lab/analysis-step-drawer.tsx`
- Per-item toggle: `app/routes/lab/analyses.tsx`
- `act()` with `?respond-with-json`: `app/framework/controllers/act.server.ts`
