---
name: mcp-server
description: Extend and maintain the app's MCP server — add tools for new or existing app capabilities, keep the CI parity check green, and work with the OAuth 2.1 layer. Use when adding or changing any business function or route (the parity test will demand MCP coverage), when writing MCP tools, when working on app/mcp/, the /mcp endpoint, OAuth routes, scopes, or the consent screen, or when the user mentions MCP, tools, or the parity check.
---

# App MCP Server

Everything a human can do in the app is also doable through MCP tools, with identical authentication and authorization. The server is stateless, OAuth 2.1-protected, and its coverage is CI-enforced: `app/mcp/parity.test.ts` fails whenever a route-invoked business function has no MCP tool.

## Architecture map

- `app/routes/mcp.ts` — the Streamable HTTP endpoint (POST only). Anonymous requests (no Authorization header) are served the anonymous toolset; invalid/expired tokens get 401 + `WWW-Authenticate`; tokens must be audience-bound to `${baseUrl}/mcp`.
- `app/mcp/context.server.ts` — token → context bridge. Resolves the access token, loads the user, and builds the exact context object routes build (via `buildContext` in `app/business/auth.server.tsx`). Also exports `withVenueRoles` (see venue tools below).
- `app/mcp/server.server.ts` — per-request MCP `Server` (low-level SDK API). `tools/list` filters the registry by scope × `isAvailable(context)`; `tools/call` dispatches to the tool's `execute` and maps composable-functions `Result` failures to MCP `isError` content.
- `app/mcp/tool.ts` — the `McpTool` type.
- `app/mcp/tools/<domain>.server.ts` — one file per business domain, exporting `<domain>Tools: McpTool[]`.
- `app/mcp/registry.server.ts` — aggregates every domain array. Accumulate-only; rebase conflicts resolve keep-both.
- `app/mcp/parity.test.ts` + `parity-exemptions.ts` + `pending-coverage.ts` — the parity check (below).
- OAuth layer: `app/business/oauth.server.ts` / `oauth.common.ts`, routes under `app/routes/oauth/`, `app/routes/well-known/`, consent screen `app/routes/mcp/authorize.tsx`.

## The one rule that matters

**A tool's `execute` is a single call to an existing `app/business` composable function with the real context object.** Never re-implement business logic, never build a context by hand, never add authorization logic. The business function's `applySchema` context schema re-validates permissions and its queries stay scoped — the same three layers the app enforces. `isAvailable` only ever uses the shared predicates from `app/business/auth.common.ts` (`hasLabPermission`, `hasVenuePermission`, `hasLabAccess`).

The sole sanctioned exception is `profile_whoami` (app/mcp/tools/auth.server.ts): it projects three explicit context fields with no business function behind it. Do not add more exceptions.

## Adding a tool

Follow `app/mcp/tools/plans.server.ts` as the canonical example:

```ts
{
  name: 'plans_create',
  description: 'Create a subscription plan with a name and a monthly price in reais.',
  inputSchema: createPlanSchema,            // ALWAYS the schema from <domain>.common.ts — never redefined
  scope: 'lab',
  wraps: ['plans.createPlan'],              // module.functionName — feeds the parity test
  isAvailable: (context) => hasLabPermission(context.currentLabRole, 'plans:manage'),
  execute: (input, context) => plans.createPlan(input, context),
}
```

Conventions:

- **Name**: `snake_case`, `<domain>_<verb_phrase>` in clear domain language (`visits_check_in`, `reference_tables_create_range`). No abbreviations.
- **Description**: one outcome-oriented English sentence a client model can act on. Say what it does and what the key inputs mean when non-obvious.
- **Input schema**: reuse the business function's input schema from the domain's `.common.ts`. If the function receives route params (e.g. `planId`, `venueId`) merged in by `act`/`load`, the tool's schema must include them — extend the base schema exactly like the business function's own schema does, or reuse the already-extended one.
- **Date inputs**: a schema containing `z.date()` (or a date-coercing `z.preprocess`/`z.union`) cannot be a tool's `inputSchema` — `z.toJSONSchema` throws on it even in `io: 'input'` mode. Use `isoDateSchema()` from `app/framework/schemas.ts` (an ISO `YYYY-MM-DD` string transformed to a local-midnight `Date`) in the business function's input schema itself, so app and MCP share one shape.
- **Scope** (consent-time restriction, layered on top of role authz): `'anonymous'` (no token needed), `'profile'`, `'care'`, `'lab'`, `'venues'`.
- **isAvailable** mirrors the route's context getter: lab getters → `hasLabPermission(context.currentLabRole, '<permission>')`; `getLabAccessContext` → `hasLabAccess(context.currentLabRole)`; customer surface → `Boolean(context.currentCustomer)`; user surface → `Boolean(context.currentUser)`; anonymous → `() => true`. Find the route's getter in the route file that invokes the function.
- Register the domain array in `registry.server.ts` (one import + one spread).

### Venue tools

The MCP context has no venue roles (they are per-venue). Venue-scoped tools fetch them per call with the shared helper — same query the app's `getVenueOperateContext` runs, same schema denial:

```ts
execute: async (input, context) =>
  visits.checkIn(input, await withVenueRoles(input, context)),
```

`withVenueRoles(input, context)` reads `venueId` from the input and returns the context with `currentVenueRoles` attached (empty when the user has no roles there — the business function's `venueOperateContextSchema`/refined variants then deny, exactly like the app). `isAvailable` for venue tools is `(context) => Boolean(context.currentUser)` — per-venue permission can only be checked at call time.

### Anonymous tools

Only for capabilities the app serves without a session (checkout entry, magic-link request). The anonymous surface is exactly what the app serves logged-out — never more.

## The parity check

`pnpm run test:unit` runs `app/mcp/parity.test.ts`, which extracts every business function invoked by `app/routes/**` (TypeScript compiler API) and asserts each is **wrapped** (some tool's `wraps`), **exempted** (`parity-exemptions.ts`, with a written reason — e.g. OAuth plumbing, Stripe webhook internals), or **pending** (`pending-coverage.ts`). It also fails on stale pending entries (already wrapped) and dangling `wraps` (function no routes invoke).

- **Adding an app capability?** The parity test fails until you add the MCP tool (or a reasoned exemption). Add the tool in the same PR — that is the Definition of Done.
- **Covering pending functions?** Remove them from `pending-coverage.ts` in the same commit that wraps them.
- Exemptions are rare and must say why the function is not a user capability.

## Testing tools

Use `app/test/prelude.ts` factories and call the helpers directly (see `app/mcp/server.server.test.ts`):

- **Denial**: `callTool` with a context missing the permission (e.g. `createUserCtxWithPermissions(['results:manage'])` for a plans tool) → expect `isError: true` with the context schema's message. This proves the same-code-path guarantee.
- **Visibility**: `listTools` with scopes/permissions combinations → tool present/absent.
- **Happy path**: at least one representative call per domain proving input schema and result shape.

## OAuth layer (rarely touched)

OAuth 2.1: dynamic client registration (RFC 7591), discovery (RFC 8414 + 9728), authorization-code + PKCE S256 (verifier checked constant-time at exchange; wrong verifier burns the single-use code), refresh rotation, all credentials SHA-256-hashed at rest. Scopes: `profile care lab venues`; a request whose scope string matches none of these is rejected as `invalid_scope`; omitted scope defaults to all four. Consent lives at `/mcp/authorize` (design-system screen, gated by `getUserContext`, so sign-in is the normal magic-link flow). Tokens are audience-bound: `resource` must equal `${baseUrl}/mcp` or the endpoint rejects with `invalid_audience`. Keep every credential hashed, keep PKCE mandatory, and never introduce an in-memory session store — the endpoint is stateless by design.
