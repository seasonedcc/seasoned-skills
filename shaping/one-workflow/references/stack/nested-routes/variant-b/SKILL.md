---
name: nested-routes
description: Create nested route sections with layouts, index redirects, and menu navigation in React Router v7. Use when adding new route groups, creating layouts with sidebar navigation, nesting routes under a parent path, or restructuring flat routes into nested ones.
---

# Nested Routes

Guidelines for creating nested route sections with React Router v7 config-based routing.

## Route Config

Use `route` with children — not `layout` + `...prefix`. A single `route('path', 'layout.tsx', [...children])` provides both the layout wrapper and path prefix:

```ts
// Correct
route('dashboard', 'routes/dashboard/layout.tsx', [
  index('routes/dashboard/index.ts'),
  route('settings', 'routes/dashboard/settings.tsx'),
])

// Wrong — redundant, layout + prefix does the same thing
layout('routes/dashboard/layout.tsx', [
  ...prefix('dashboard', [
    index('routes/dashboard/index.ts'),
    route('settings', 'routes/dashboard/settings.tsx'),
  ]),
])
```

Always update `app/routes.ts` when changing routes.

## Loaders Run in Parallel

Parent and child loaders execute in parallel in React Router v7. A layout loader does NOT gate child route loaders. Every leaf route must authorize independently.

The specific context getter varies by surface (`getContext` for public pages, `getUserContext` for authenticated ones, `getCompanyContext` for company-scoped ones). The principle is the same — every route that needs authorization must call its own context getter:

```ts
// layout.tsx — runs auth for its own UI needs, does NOT protect children
export async function loader({ request, params }: Route.LoaderArgs) {
  await getAdminContext(request, params)
  return null
}

// settings.tsx — must run its own auth, cannot rely on the layout
export async function loader({ request, params }: Route.LoaderArgs) {
  await getAdminContext(request, params)
  const data = await getSettings()
  return { data }
}
```

## Avoid Parallel Redirects

When a parent and child loader both redirect, the results race. The layout's flash message may be lost if the child redirect wins. To prevent this, every loader that redirects must first run the same auth check as the layout. This way, the child loader either redirects to the auth page itself (with the flash message) or proceeds knowing the user is authorized — never racing with a conflicting redirect from the parent:

```ts
// index.ts — authorizes BEFORE redirecting to avoid racing with layout's auth redirect
export async function loader({ request, params }: Route.LoaderArgs) {
  await getAdminContext(request, params)
  return redirect(MENU_ITEMS[0].to)
}
```

## Menu Items as a Shared Constant

Extract menu items to a separate data file (`menu-items.ts`) so both the layout and the index redirect can import it. The index redirect uses `MENU_ITEMS[0].to` to dynamically adapt if the first item changes:

```ts
// menu-items.ts
import type { ComponentType } from 'react'
import { SettingsIcon } from 'lucide-react'
import { href } from 'react-router'

type MenuItem = {
  name: string
  to: string
  icon: ComponentType<{ className?: string }>
}

const MENU_ITEMS: MenuItem[] = [
  { name: 'Settings', to: href('/dashboard/settings'), icon: SettingsIcon },
]

export { MENU_ITEMS }
export type { MenuItem }
```

## Layout File Structure

The layout file is the route module pointed to by `route()` in the config. It renders `<Outlet />` for child routes. Child pages should not include `<main>` wrappers or page chrome (sign-out buttons, navigation) since the layout provides those.

Reference implementation: `app/routes/app/layout.tsx`

## Error Boundaries

The app exports a `NestedErrorBoundary` from `~/ui/error-boundary` for use on nested page routes:

```ts
export { NestedErrorBoundary as ErrorBoundary } from '~/ui/error-boundary'
```

**Rules:**

1. **Page routes** export ErrorBoundary — whether they are leaf routes (e.g., `profile.tsx`) or routes with child drawers/modals (e.g., `inventory/locations.tsx`, `purchase-orders/index.tsx`). If it renders its own page content, it gets an ErrorBoundary.

2. **Section layouts** (`layout.tsx` files that only provide chrome like navigation/sidebar and render `<Outlet />`) do NOT export ErrorBoundary. They don't render page content themselves — the root error boundary handles their errors.

3. **Drawer/modal routes** do NOT export ErrorBoundary. When a drawer route has its own error boundary, errors render inline within the drawer's position in the component tree, producing broken UI. By omitting it, errors bubble up to the parent page route's error boundary, which renders the error in the full page context.

4. **Action-only routes** (`.ts` files with no component) and **index redirects** do NOT export ErrorBoundary — they have no UI.

## Meta Tags and Title Management

React 19 does NOT deduplicate `<title>` tags on the server side. If multiple routes in a hierarchy render `<title>`, the HTML will contain multiple `<title>` tags. To prevent this, only the **outermost content route** in each branch sets meta tags.

**Rules:**

1. **Layout routes** (`layout.tsx`, `root.tsx`) must NOT render `<title>` — leaf routes handle it.

2. **Page routes** (the outermost route that renders its own content) set meta tags. This includes "hybrid" routes that have `<Outlet>` for modals/drawers but also display their own content (e.g., list pages, detail pages).

3. **Child routes** rendered inside a parent's `<Outlet>` (modals, drawers, new/edit forms) do NOT set meta tags — the parent already does.

4. **Action-only and redirect-only routes** don't need meta tags (no UI).

Use a shared `MetaTags` component to standardize title format across the app. Example from `app/ui/meta-tags.tsx`:

```tsx
import { MetaTags } from '~/ui/meta-tags'

// Static title (list pages)
<MetaTags title="Products" layout="app" />

// Dynamic title (detail pages)
<MetaTags title={product.name} layout="app" />
```

## File Organization

```
app/routes/section-name/
├── menu-items.ts                  — Shared MENU_ITEMS constant
├── layout.tsx                     — Layout + <Outlet /> (no ErrorBoundary, no MetaTags)
├── index.ts                       — Redirect to MENU_ITEMS[0].to (no ErrorBoundary, no MetaTags)
├── page-name.tsx                  — Page route (ErrorBoundary ✓, MetaTags ✓)
├── action-name.ts                 — Action-only (no ErrorBoundary, no MetaTags)
└── nested-drawer-or-modal/
    └── drawer-name.tsx            — Drawer/modal (no ErrorBoundary, no MetaTags)
```
