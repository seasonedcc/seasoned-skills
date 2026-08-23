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
- `getCompanyContext` - Requires authenticated user with an active company scope
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

**Example with getCompanyContext** (`app/routes/app/home.tsx`):

```typescript
import { getCompanyContext } from '~/business/auth.server'
import { load } from '~/framework/controllers.server'

export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await getCompanyContext(request, params)
  return load(fetchHomeTimeline)({ request, params, context })
}
```

The `getCompanyContext` ensures:
- User is authenticated
- User has an active company scope
- Returns context with `currentCompany`, `currentUser`, etc.

### Layer 3: Business Functions

Business functions enforce authorization with context schemas. Prefer validating context with schemas rather than custom logic.

**Available context schemas**:
- `contextSchema` - Allows `currentUser: null`
- `userContextSchema` - Requires authenticated `currentUser`
- `companyContextSchema` - Requires authenticated user with a `currentCompany`
- `adminContextSchema` - Requires authenticated user with `admin: true`

**Key principle**: Use `applySchema(inputSchema, contextSchema)` to validate both input and authorization context.

**Example** (`app/business/products.server.ts`):

```typescript
import { applySchema } from 'composable-functions'
import { companyContextSchema } from '~/business/auth.server'
import { createProductSchema } from '~/business/products.common'

const createProduct = applySchema(
  createProductSchema,
  companyContextSchema
)(async ({ name, sku, unitId }, { currentCompany }) => {
  return db()
    .transaction()
    .execute(async (trx) => {
      const product = await trx
        .insertInto('products')
        .values({ companyId: currentCompany.id })
        .returning('id')
        .executeTakeFirstOrThrow()

      await trx
        .insertInto('productRevisions')
        .values({ productId: product.id, name, sku, unitId })
        .execute()

      return { product }
    })
})
```

This function:
1. Validates input matches `createProductSchema`
2. Validates context matches `companyContextSchema` (authenticated user with an active company scope)
3. Only executes if both validations pass
4. Has type-safe access to `context.currentCompany`

**Example with multiple schemas**:

```typescript
const reviseProduct = withContext.pipe(
  applySchema(
    reviseProductSchema.extend({ productId: z.string() }),
    companyContextSchema
  ),
  composable(async ({ productId, ...revision }, context) => {
    // Authorization already validated by companyContextSchema
    const { currentCompany } = context

    // Additional authorization if needed
    if (!(await belongsToCompany(productId, currentCompany.id))) {
      throw new Error('You cannot edit this product')
    }

    // Append the revision event...
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
  currentCompany: currentCompanySchema.nullable(),
  
})

const userContextSchema = contextSchema.extend({
  currentUser: currentUserSchema, // No longer nullable
})

const companyContextSchema = userContextSchema.extend({
  currentCompany: currentCompanySchema,
  
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
3. Further extend for domain-specific contexts (e.g., `companyContextSchema`, `adminContextSchema`)

Each schema should validate exactly what the business function needs to operate safely.

## Role Abstractions

When a role or authorization concept needs to be shared across multiple places, make context-getters return an abstracted value and reference it in schemas.

**Example** (`app/business/auth.server.tsx`):

```typescript
async function getCompanyContext(request: Request, params: Params) {
  const { currentCompany, currentMembership, ...context } =
    await getUserContext(request, params)

  if (!currentCompany) {
    throw redirect('/', {
      headers: await setFlashMessage(request)(
        'You do not have access to this page.'
      ),
    })
  }

  return {
    ...context,
    currentCompany,
    currentMembership: currentMembership,
  }
}

const companyContextSchema = userContextSchema.extend({
  currentCompany: currentCompanySchema,
  
})
```

The abstracted `currentCompany` and `currentMembership` can then be referenced in:
- Context schemas for validation
- Business functions for company-scoped access checks
- Helper functions like `isCompanyManager(currentMembership)`

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
const discardProject = applySchema(
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
    throw new Error('Only the project owner can discard it')
  }

  // Proceed with appending the discard event...
})
```

Prefer schemas when possible, but don't hesitate to add custom checks for complex authorization logic.

## Organization scope comes from the active company

A user can belong to several organizations, so org identity is never derived from the user. It is `context.currentCompany.organizationId` — carried by `currentCompanySchema` alongside `organizationName` and driven solely by the active company. Everything org-scoped follows it:

- Permissions and modules derive per organization: `effectivePermissionKeys(executor, userId, organizationId)` takes the org id as a **required** parameter, so a role or user-extra grant in one organization confers nothing in another. `unionEffectivePermissionKeys` exists solely for MCP tool-listing visibility, never enforcement.
- A business function that needs an organization uses a `companyContextSchema`-based schema and reads the org id from the context — never from a lookup over the user's memberships.
- Over MCP, tokens are user-wide and the per-call `companyId` disambiguates: `withCompany` recomputes org-scoped permissions and modules before any tool executes.
- An employee's status (inactive, terminated) scopes access to that organization's companies only — it never blocks sign-in, and copy or logic implying otherwise is wrong.
- Person names on org-scoped surfaces are per-organization — use the `display-names.server.ts` fragments (see the kysely skill), not the global profile.

## Every foreign id in a write is a tenancy check

Context schemas prove who the caller is; they say nothing about what the input ids point at. In a multi-company schema, **every** foreign entity id accepted as input — on creates as much as edits — must be verified against the current company before use (`belongsToCompany` or an ownership-scoped fetch). A function that checks `locationId` but inserts `productId` verbatim is a cross-tenant leak through the unchecked id, and a nonexistent id surfaces as a raw FK 500 instead of a friendly `InputError`.

The same applies to user-suppliable overrides of server-derived values (a typed price, a manual quantity): the override changes the amount only — the underlying entity still gets full tenancy and existence validation, and every such path gets a cross-company negative test.

## Authorize action-only routes before any keyed read

Action-only routes must authorize explicitly at the top of the `action`, before ANY `params`-keyed database read or input-schema selection. Context getters return capability booleans without throwing, and `applySchema`'s context validation runs only inside `act()` — so anything computed before `act()` runs for every authenticated user. A `params`-keyed lookup, or a branch that picks between input schemas before the authorization check, leaks information through differential behavior: a validation error that differs by the target's state tells any signed-in tenant something about a resource they cannot access.

## Match the router's path normalization in a prefix gate

A gate that authorizes by URL prefix must resolve the request path exactly as the router resolves it, or a cosmetic URL variant the router still routes to the surface bypasses it. React Router matches case-insensitively and percent-decodes each path segment before matching, so a raw, case-sensitive prefix comparison lets `/app/Purchase-Orders` and `/app/purchase%2Dorders` reach the real loader and action while the gate sees no match — a read and write bypass at once. Normalize before comparing: split on `/`, `decodeURIComponent` each segment (falling back to the raw segment when decoding throws), then `toLowerCase`. Pin adversarial-path tests on every such gate — mixed case, percent-encoded, and trailing slash — and for a write surface assert the action returns 404 and that no row was written before the write.

## Testing permission gates

Never test an authorization gate with a context that grants either nothing or everything — such a test stays green when the getter checks the *wrong* key (an `approve_purchaseorder`/`approve_sales_order` swap passes both ways). Grant exactly the one permission key under test through the real fixture and the real context getter, assert the sibling capabilities stay false, and prove the test by swapping the key literal in the getter and watching that specific test fail.

## A new permission key ships with a role backfill migration

`grantEveryPermission` grants the full catalog only at role provisioning (`administrator-role.server.ts`), so a key added to `permissionCatalog` reaches only orgs provisioned after the deploy — every existing org's Administrator silently lacks it, and the feature it gates disappears for the admins who run those orgs today. Dev and CI hide this: each fresh seed provisions the Administrator role from an empty database, so `seedAdministratorRoleForOrganization` grants the full catalog including the new key — the gap only surfaces in production. Every catalog addition therefore ships in the same PR with an append-only backfill migration that grants the new key to the roles whose latest effective toggle for a proxy key is a grant — `view_company`/`change_company` for a company-scoped view/change pair. Copy the precedent (`app/db/migrations/*-backfill-subscription-permissions.ts`): a raw-SQL latest-toggle derivation frozen in the file, a `NOT EXISTS` guard for idempotency, and a no-op `down()` (see the database-design skill for why a backfill's reversal is a documented no-op).

## Best Practices

1. **Always use context getters in loaders/actions** - Never manually check authentication; let getters handle it
2. **Always use context schemas in business functions** - Validate context at the function boundary
3. **Keep authorization centralized** - Don't scatter auth checks across many files
4. **Use appropriate context level** - `getContext` for public routes, `getUserContext` for authenticated routes, `getCompanyContext` for company-scoped routes, `getAdminContext` for admin-only routes
5. **Trust the layers** - Components trust loaders, loaders trust context getters, business functions trust schemas
6. **Add custom checks sparingly** - Prefer schema validation; add explicit checks only when schemas can't express the requirement
7. **Abstract wisely** - Create role abstractions when concepts are shared broadly, but avoid over-abstracting

## Troubleshooting

### "Context schema validation failed"

**Cause**: Business function received context that doesn't match the required schema.

**Solution**: Ensure the loader/action uses the appropriate context getter:
- For `contextSchema` → use `getContext`
- For `userContextSchema` → use `getUserContext`
- For `companyContextSchema` → use `getCompanyContext`
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
- Business function examples: `app/business/products.server.ts`
- Route loader examples: `app/routes/dashboard.tsx`, `app/routes/app/home.tsx`
- Base auth utilities: `app/framework/auth.server.ts`
