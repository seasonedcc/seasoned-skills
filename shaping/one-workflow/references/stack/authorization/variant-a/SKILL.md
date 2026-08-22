---
name: authorization
description: Implement authorization using context getters, context schemas, and composable functions. Use when working with authentication, permissions, user access control, protected routes, business logic authorization, or when user mentions auth, context, permissions, or access control.
---

# Authorization

This skill documents the authorization architecture used in this repo. The pattern enforces security through three coordinated layers: UI components, route loaders/actions, and business functions.

## Overview

Authorization uses a layered approach where each layer has specific responsibilities:

1. **Components** - Render UI based on loader data, no authorization logic
2. **Loaders and Actions** - Obtain context via getters, perform redirects, pass context to business functions
3. **Business Functions** - Enforce authorization with context schemas, throw errors on violations

This architecture ensures that:
- Authorization logic is centralized and consistent
- Every layer validates permissions appropriately
- Business functions cannot be invoked without proper context
- Unauthorized access is caught early and redirected appropriately

## Three-Layer Architecture

### Layer 1: Components

Components rely on data returned from loaders to make UI decisions. They determine whether to render privileged buttons, links, or sections based on the data available.

**Key principle**: Components do not perform redirects or authorization checks. They trust loader data.

**Example** (`app/routes/dashboard.tsx`):

```typescript
import { getUserContext } from '~/business/auth.server'
import type { Route } from './+types/dashboard'

export async function loader({ request, params }: Route.LoaderArgs) {
  return getUserContext(request, params)
}

export default function Dashboard() {
  return (
    <main className="container mx-auto p-4 pt-16">
      <title>Dashboard</title>
      <div className="flex items-center justify-between">
        <h1 className="h1">Dashboard</h1>
        <Form method="post" action="/auth/sign-out">
          <button type="submit" className="btn btn-primary">
            Sign Out
          </button>
        </Form>
      </div>
    </main>
  )
}
```

In this example, the component simply renders UI. The `getUserContext` call in the loader ensures only authenticated users reach this component (unauthenticated users are redirected).

### Layer 2: Loaders and Actions

Loaders and actions obtain environment and user information via context-getter utilities. These helpers perform authorization checks and redirect when users lack permission.

**Available context getters**:
- `getContext` - Returns base context (may include `currentUser: null`)
- `getUserContext` - Requires authenticated user, redirects to `/auth` if not
- `getCustomerContext` - Requires authenticated user with an associated customer record
- `getAdminContext` - Requires authenticated user with admin privileges

**Key principle**: When invoking business functions, use the `act` or `load` helpers to ensure context is always passed along.

**Example with getUserContext** (`app/business/auth.server.tsx`):

```typescript
async function getUserContext(request: Request, params: Params) {
  const { currentUser, ...env } = await getContext(request, params)

  return getAuthenticatedContext(request)(currentUser, env, (session) => {
    return setFlashMessage(request)(
      'Please sign in to continue.',
      'warning',
      session
    )
  })
}
```

The `getUserContext` helper:
1. Gets the base context (which may have `currentUser: null`)
2. Calls `getAuthenticatedContext` which checks if `currentUser` exists
3. If not authenticated, redirects to `/auth?return-to=...` with a flash message
4. If authenticated, returns the context with guaranteed `currentUser`

**Example with getCustomerContext** (`app/routes/care/home.tsx`):

```typescript
import { getCustomerContext } from '~/business/auth.server'
import { load } from '~/framework/controllers.server'

export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await getCustomerContext(request, params)
  return load(fetchHomeTimeline)({ request, params, context })
}
```

The `getCustomerContext` ensures:
- User is authenticated
- User has an associated customer record
- Returns context with `currentCustomer`, `planSubscription`, `currentUser`, etc.

### Layer 3: Business Functions

Business functions enforce authorization with context schemas. Prefer validating context with schemas rather than custom logic.

**Available context schemas**:
- `contextSchema` - Allows `currentUser: null`
- `userContextSchema` - Requires authenticated `currentUser`
- `customerContextSchema` - Requires authenticated user with a `currentCustomer`
- `adminContextSchema` - Requires authenticated user with `admin: true`

**Key principle**: Use `applySchema(inputSchema, contextSchema)` to validate both input and authorization context.

**Example** (`app/business/customers.server.tsx`):

```typescript
import { applySchema } from 'composable-functions'
import { adminContextSchema } from '~/business/auth.server'
import { createCustomerSchema } from '~/business/customers.common'

const createCustomer = applySchema(
  createCustomerSchema,
  adminContextSchema
)(async ({ fullName, cpf, birthDate, sexAtBirth }) => {
  const [customer] = await db()
    .insertInto('customers')
    .values({ fullName, cpf, birthDate, sexAtBirth })
    .returning(['id', 'fullName'])
    .execute()

  return { customer }
})
```

This function:
1. Validates input matches `createCustomerSchema`
2. Validates context matches `adminContextSchema` (authenticated user with `admin: true`)
3. Only executes if both validations pass
4. Has type-safe access to `context.currentUser` (with `admin: true` guaranteed)

**Example with multiple schemas**:

```typescript
const updateCustomer = withContext.pipe(
  applySchema(
    updateCustomerSchema.extend({ customerId: z.string() }),
    adminContextSchema
  ),
  composable(async ({ customerId, ...updates }, context) => {
    // Authorization already validated by adminContextSchema
    const { currentUser } = context

    // Additional authorization if needed
    if (!canEditCustomer(currentUser, customerId)) {
      throw new Error('You cannot edit this customer')
    }

    // Business logic...
  })
)
```

## Context Getters Implementation Pattern

Each app defines its own context getters in `app/business/auth.server.tsx` (or `.tsx`). The typical pattern:

```typescript
import { getAuthenticatedContext } from '~/framework/auth.server'
import { z } from 'zod'

async function getContext(request: Request, params: Params) {
  const baseUrl = getBaseUrl(request)
  const currentUserRecord = await getOptionalCurrentUser(request)

  // Optional: enforce profile completion or other checks
  if (
    currentUserRecord &&
    !currentUserRecord.firstName &&
    new URL(request.url).pathname !== '/auth/complete-profile'
  ) {
    await throwRedirect(request, '/auth/complete-profile')
  }

  const currentUser = currentUserRecord
    ? (currentUserRecord as z.infer<typeof currentUserSchema>)
    : null

  return {
    baseUrl,
    currentUser,
    // ... other environment context
  }
}

async function getUserContext(request: Request, params: Params) {
  const { currentUser, ...env } = await getContext(request, params)

  return getAuthenticatedContext(request)(currentUser, env, (session) => {
    // Optional: custom redirect headers (e.g., flash messages)
    return setFlashMessage(request)(
      'Please sign in to continue.',
      'warning',
      session
    )
  })
}

const currentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
})

const contextSchema = z.object({
  baseUrl: z.string(),
  currentUser: currentUserSchema.nullable(),
})

const userContextSchema = contextSchema.extend({
  currentUser: currentUserSchema,
})

export { contextSchema, getContext, getUserContext, userContextSchema }
```

Key elements:
- `getContext` returns base context with optional user
- `getUserContext` ensures authenticated user or redirects
- Context schemas provide type safety and validation
- Export both getters and schemas for use in routes and business functions

## Context Schemas Pattern

Context schemas validate the authorization context passed to business functions. They follow a hierarchy:

```typescript
const contextSchema = z.object({
  baseUrl: z.string(),
  currentUser: currentUserSchema.nullable(),
  currentCustomer: currentCustomerSchema.nullable(),
  planSubscription: planSubscriptionSchema.nullable(),
})

const userContextSchema = contextSchema.extend({
  currentUser: currentUserSchema, // No longer nullable
})

const customerContextSchema = userContextSchema.extend({
  currentCustomer: currentCustomerSchema,
  planSubscription: planSubscriptionSchema.nullable(),
})

const adminContextSchema = userContextSchema.extend({
  currentUser: currentUserSchema.extend({
    admin: z.literal(true),
  }),
})
```

Pattern:
1. Start with base `contextSchema` (allows null user)
2. Extend to `userContextSchema` (requires user)
3. Further extend for domain-specific contexts (e.g., `customerContextSchema`, `adminContextSchema`)

Each schema should validate exactly what the business function needs to operate safely.

## Role Abstractions

When a role or authorization concept needs to be shared across multiple places, make context-getters return an abstracted value and reference it in schemas.

**Example** (`app/business/auth.server.tsx`):

```typescript
async function getCustomerContext(request: Request, params: Params) {
  const { currentCustomer, planSubscription, ...context } =
    await getUserContext(request, params)

  if (!currentCustomer) {
    throw redirect('/', {
      headers: await setFlashMessage(request)(
        'Você não tem acesso a esta página.'
      ),
    })
  }

  return {
    ...context,
    currentCustomer,
    planSubscription: planSubscription ?? null,
  }
}

const customerContextSchema = userContextSchema.extend({
  currentCustomer: currentCustomerSchema,
  planSubscription: planSubscriptionSchema.nullable(),
})
```

The abstracted `currentCustomer` and `planSubscription` can then be referenced in:
- Context schemas for validation
- Business functions for customer-specific access checks
- Helper functions like `hasActiveSubscription(planSubscription)`

**Best practice**: Keep role abstractions small and broadly useful. Avoid proliferating too many abstractions.

## Using act() and load() Helpers

When invoking business functions from loaders or actions, use the `act()` or `load()` helpers to ensure context is passed correctly.

**load() example**:

```typescript
import { load } from '~/framework/controllers.server'

export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await getUserContext(request, params)

  return load(fetchUserDashboard)(context)
}
```

**act() example**:

```typescript
import { act } from '~/framework/controllers.server'

export async function action({ request, params }: Route.ActionArgs) {
  const context = await getUserContext(request, params)

  return act(updateUserProfile)({
    schema: updateUserProfileSchema,
    request,
    params,
    context,
  })
}
```

These helpers:
- Ensure business functions receive proper context
- Handle errors consistently
- Provide type safety for context passing

## Custom Authorization Logic

When context schemas aren't enough, add explicit checks in business functions and throw errors:

```typescript
const deleteProject = applySchema(
  z.object({ projectId: z.string() }),
  userContextSchema
)(async ({ projectId }, context) => {
  const project = await db()
    .selectFrom('projects')
    .where('id', '=', projectId)
    .select(['ownerId'])
    .executeTakeFirst()

  if (!project) {
    throw new Error('Project not found')
  }

  if (project.ownerId !== context.currentUser.id) {
    throw new Error('Only the project owner can delete it')
  }

  // Proceed with deletion...
})
```

Prefer schemas when possible, but don't hesitate to add custom checks for complex authorization logic.

## Testing permission gates

Never test an authorization gate with a context that grants either nothing or everything — such a test stays green when the getter checks the *wrong* key (an `analyses:manage`/`results:manage` swap passes both ways). Grant exactly the one permission key under test through the real fixture and the real context getter, assert the sibling capabilities stay false, and prove the test by swapping the key literal in the getter and watching that specific test fail.

## Best Practices

1. **Always use context getters in loaders/actions** - Never manually check authentication; let getters handle it
2. **Always use context schemas in business functions** - Validate context at the function boundary
3. **Keep authorization centralized** - Don't scatter auth checks across many files
4. **Use appropriate context level** - `getContext` for public routes, `getUserContext` for authenticated routes, `getCustomerContext` for customer-specific routes, `getAdminContext` for admin-only routes
5. **Trust the layers** - Components trust loaders, loaders trust context getters, business functions trust schemas
6. **Add custom checks sparingly** - Prefer schema validation; add explicit checks only when schemas can't express the requirement
7. **Abstract wisely** - Create role abstractions when concepts are shared broadly, but avoid over-abstracting

## Common Patterns

### Public Route (Optional Auth)

```typescript
export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await getContext(request, params)

  return {
    currentUser: context.currentUser, // May be null
    publicData: await fetchPublicData(),
  }
}
```

### Protected Route (Required Auth)

```typescript
export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await getUserContext(request, params)

  return load(fetchPrivateData)(context)
}
```

### Domain-Specific Protected Route

```typescript
export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await getCustomerContext(request, params)

  return load(fetchHomeTimeline)({ request, params, context })
}
```

### Business Function with Custom Auth

```typescript
const updateResource = applySchema(
  z.object({ resourceId: z.string(), updates: z.object({...}) }),
  userContextSchema
)(async ({ resourceId, updates }, context) => {
  const resource = await fetchResource(resourceId)

  if (resource.ownerId !== context.currentUser.id) {
    throw new Error('Unauthorized')
  }

  return updateResourceInDb(resourceId, updates)
})
```

## Resource Routes

Resource routes serve XHR/fetch clients instead of rendering pages — file endpoints, data endpoints, webhooks — and are typically mounted at the top level of `routes.ts`, outside every layout. The three-layer architecture applies to them with two adjustments:

- **They guard themselves.** A route outside every layout inherits nothing from layout loaders; the module's own loader/action is the only gate. Call a context getter as the first statement, before reading the request body, and never assume the surrounding app implies a session.
- **Match the response to the client's shape.** A resource route consumed programmatically (XHR/fetch — `/upload` is the canonical case) answers with status codes: use `getContext` and return `401` (no session), `403` (no permission), or the appropriate `4xx`, because a login redirect surfaces there as a garbled parse failure. A resource route consumed by real browser navigations (`<a>`, `<a download>` — `/download` is the canonical case) uses `getUserContext`: its sign-in redirect carries a `return-to` that resumes the navigation after login, which no status code can do. When one route serves both shapes (`/download` is also the `src` of `<img>` tags, where a redirect renders as a silently broken image), design for the deliberate interaction — the click — and accept the degraded secondary.

Client-side validation on the calling UI (file-size caps, type restrictions) is advisory UX only. Enforce every limit again in the resource route: an attacker talks to the endpoint directly, not to the component in front of it.

```typescript
export async function action({ request, params }: Route.ActionArgs) {
  const { currentUser } = await getContext(request, params)

  if (!currentUser) {
    return new Response('Faça login para continuar.', { status: 401 })
  }

  // Permission check → 403, content-type/size limits → 4xx, then the work
}
```

## Troubleshooting

### "Context schema validation failed"

**Cause**: Business function received context that doesn't match the required schema.

**Solution**: Ensure the loader/action uses the appropriate context getter:
- For `contextSchema` → use `getContext`
- For `userContextSchema` → use `getUserContext`
- For `customerContextSchema` → use `getCustomerContext`
- For `adminContextSchema` → use `getAdminContext`

### Redirect loops

**Cause**: Protected route redirects to auth, which redirects back, infinitely.

**Solution**: Check that auth routes use `getContext` (not `getUserContext`). Ensure `getOptionalCurrentUser` is used correctly in context getters.

### TypeScript errors on context properties

**Cause**: Context schema doesn't match the actual context type.

**Solution**: Ensure context getter returns all properties defined in the schema. Check that schema extends are correct (e.g., `userContextSchema` extends `contextSchema`).

### Business function doesn't redirect unauthorized users

**Cause**: Business function validates context but doesn't get invoked via loader/action context getter.

**Solution**: Always call context getters in loaders/actions before invoking business functions. The getter handles redirects; business functions handle validation and errors.

## References

- Context getter implementation: `app/business/auth.server.tsx`
- Business function examples: `app/business/customers.server.tsx`
- Route loader examples: `app/routes/dashboard.tsx`, `app/routes/care/home.tsx`
- Base auth utilities: `app/framework/auth.server.ts`
