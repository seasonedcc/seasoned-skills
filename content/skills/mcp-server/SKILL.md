---
name: mcp-server
description: Build and extend the app's MCP server — the machine surface that exposes app capabilities as tools over OAuth 2.1, held to capability parity with the product. Use when adding or changing an MCP tool, wiring a new domain into the MCP server, touching app/mcp/*, the oauth business layer, or the /mcp, /oauth/*, or /.well-known/* routes, when working on the parity check, the exception register, or pending-coverage, or when the user mentions MCP, tools, Model Context Protocol, OAuth, bearer tokens, scopes, or the consent screen.
---

# MCP Server

The app speaks the Model Context Protocol at `/mcp`: an MCP client (Claude, etc.) signs in through the app's OAuth 2.1 authorization server, receives a bearer token, and calls **tools** that are thin projections of the exact same business functions the app's routes call. The standard this surface is held to is **capability parity with the product** — the MCP server never serves more, and never less, than the app serves the same user. That standard is written down in the committed, project-owned parity standard at `{{parity-standard}}`; changes to the machine surface are audited against it by **outcome fitness, never endpoint existence** — a surface can have every endpoint and still fail the person using it. The mechanical half is enforced in CI by the parity check.

## Architecture map

```
app/mcp/
  tool.ts                 McpTool shape (name, description, inputSchema, scope, modules, wraps, isAvailable, execute)
  context.server.ts       token → McpContext bridge (resolveMcpContext, buildAuthenticatedContext, withCompany)
  server.server.ts        per-request Server, listTools/callTool dispatch, JSON-schema projection
  registry.server.ts      accumulate-only array of every domain's tools
  tools/<domain>.server.ts one array per domain (authTools, profileTools, ordersTools…)
  parity.test.ts          CI gate: every route-invoked business fn is wrapped/exempt/pending
  parity-exemptions.ts    route-invoked machine surfaces that are not user capabilities (with a reason each)
  pending-coverage.ts     route-invoked fns not yet wrapped — shrinks to [] as domains land

app/business/oauth.common.ts   scope enum + labels, register/scope parsing (universal)
app/business/oauth.server.ts    the OAuth 2.1 authorization server (INSERT-only, all-hashed)
app/routes/mcp.ts               Streamable HTTP endpoint (POST only)
app/routes/oauth/*              register / authorize / consent / token
app/routes/well-known/*         RFC 8414 + RFC 9728 discovery docs
```

## THE ONE RULE

A tool's `execute` is a **single business-function call, passing the real app context**. No authorization lives in `app/mcp/` — every gate is the app's own gate, reused:

- **Scope** filters visibility (an OAuth concern the app has no analog for).
- **Permission** is mirrored by `isAvailable`, which calls the same `hasPermission` / `hasStaffPermission` the route getter calls.
- **Module** entitlement is the `modules` field, checked against the resolved company's `enabledModules`.
- **Data scoping + final say** is the business function's own `applySchema(input, contextSchema)` — the enriched domain-cap context schema re-validates and scopes the query. If the app would deny it, the schema denies it here too, with the identical error message.

If a tool ever needs to *decide* something the business function doesn't already decide, the tool is wrong — push the decision into the business layer.

## Tool authoring

Add a tool by appending to its domain array in `tools/<domain>.server.ts` (create the file + register it in `registry.server.ts` for a new domain).

- **Name**: `snake_case`, `<domain>_<verb_phrase>` (`orders_list`, `orders_approve`). One tool, one capability.
- **Description**: outcome-oriented, what the caller gets — "Approve a pending order, recording the approval." Not "calls approveOrder".
- **inputSchema**: reuse the business function's own input schema (`fetchOrdersListInput` is exported from `orders.server.ts` for exactly this) and `.extend({ companyId: z.string().uuid() })` for company-scoped tools. Never redefine a schema the function already owns. Reuse the schema of the door the ROUTE actually calls: when the app narrows a business function for its users — a wrapper that omits and injects a field the user never chooses (pinning a record's provenance field, say), or a route-level injection — the tool wraps that narrowed door, never the wider raw function. Exposing the raw schema hands MCP callers a choice the app denies its users and breaks the never-more half of THE ONE RULE even though every gate passes.
- **wraps**: `['<module>.<functionName>']` — the business fn the parity check pairs this tool to.
- **scope / modules / isAvailable**: see below.
- **execute**: `(input, context) => businessFn(input, with<Domain>Context(context))`. The context passed in is already company-resolved (see the dispatch section) — the tool only layers the domain caps.

### The `with<Domain>Context` caps pattern

The app's business functions validate against *enriched* context schemas carrying boolean capability literals (`companyContextSchema.extend({ canViewOrders: z.literal(true) })`). Those literals are computed by a **pure** caps function extracted from the route getter — the single source of truth. The tool reuses it:

```ts
// orders.server.ts exports ordersCaps(context) (pure), and its getter is { ...context, ...ordersCaps(context) }
function withOrdersContext(context: McpContext) {
  return { ...context, ...ordersCaps(context) }
}
```

When you wrap a new domain, extract that domain's `<domain>Caps(context)` pure function from its route getter and refactor the getter to `{ ...context, ...<domain>Caps(context) }` (zero behavior change — the existing route tests must stay green). Reuse, never a parallel authz path.

### Role-scoped context augmentation

The same reuse rule has a second named shape, for authorization scoped to a resource the input names — per-location roles, per-team roles — that the base context cannot carry, because the roles only exist relative to a resource chosen at call time. The tool augments the context per call with a shared helper that runs the exact query the app's route getter runs:

```ts
execute: async (input, context) =>
  checkIn(input, await withLocationRoles(input, context)),
```

`withLocationRoles(input, context)` reads the resource id from the input and returns the context with the caller's roles for that resource attached — empty when the caller has none there, so the business function's context schema then denies, exactly like the app. `isAvailable` for such tools degrades to `(context) => Boolean(context.currentUser)`: per-resource permission can only be checked at call time, so visibility gates on being signed in and the real gate lives in the schema denial.

### Tools outside the rule — by criterion, never by list

Every tool wraps a route-invoked business function. A tool may stand outside that rule **only by meeting one of two criteria — never by joining a hard-coded allowlist**:

- **A pure context projection** — a capability the app exposes through no single business function, so there is nothing to wrap: a whoami tool that reflects the resolved authenticated context back, or a tool projecting a registry constant that a static page renders without invoking any business fn.
- **An MCP-only transport primitive** — the mirror image of a parity exemption. An exemption is a route-invoked function that is *not* a user capability; this is a genuine capability that *no route invokes* because the browser reaches the same outcome through a different transport (an upload-URL tool standing in for the browser's multipart byte route — see "Documents over MCP"). Since no route invokes the function, naming it in `wraps` would trip the parity dangling check; the tool carries `wraps: []` and its `execute` calls the composable directly.

Every excepted tool is listed in the committed, project-owned exception register at `{{exception-register}}`, with a one-line rationale each — and the parity check reads the register, so an unregistered exception fails the gate. A candidate that fits neither criterion gets no exception: if there is nothing to wrap there is no capability to expose (a static page is not a capability), and any capability an app route reaches must be wrapped by name.

### Scope model

The scope roster is the project's own (`oauth.common.ts` — the scope enum and labels, plus tool-level `anonymous` for the logged-out surface). The rules that hold regardless of roster:

- Composition is **scope ∧ permission ∧ module**, three independent gates — scope never substitutes for either of the others.
- A tool's scope derives from its gating permission, never from the shell page that hosts the capability.
- An administrative scope stays separate from the daily-operations scope: an agent running daily ops must not silently hold role/user management.
- `anonymous` covers exactly what the app serves logged-out — never more.
- An omitted or blank `scope` request defaults to the customer scopes; a staff/elevated scope is never a default and is granted only when explicitly requested.

### `modules` field semantics (per-tool, not per-domain)

`modules` mirrors the app's own per-route module gating at per-route granularity — some domains straddle core and a module, and a cross-domain surface may need several modules at once. List exactly the modules that must ALL be enabled. `[]` = core, no module gate.

### Dispatch — company resolution lives in `callTool`, not tools

`callTool` (server.server.ts) resolves the company and gates modules; tools never call `withCompany` themselves:

```
scope gate → isAvailable(context) → resolved = await withCompany(input, context)
           → modules gate against resolved.enabledModules → tool.execute(input, resolved)
```

`withCompany` reads `companyId` from the input, validates active membership, and swaps in that company's `enabledModules` (returns `currentCompany: null` when the input carries no `companyId`). Gating the module check against the **resolved** company closes the cross-company bypass (input companyId=B must not be checked against default company A's modules).

**List-vs-call asymmetry** (document it, it's intentional): `listTools` gates modules against the **default company's** `enabledModules` (the MCP has no current company at list time — this mirrors what the app's nav shows). A `callTool` is gated against the **input company**. So a tool can appear in the list for the default company yet deny for a different `companyId` whose module is off — exactly as the app behaves.

### Dates at the JSON boundary

The tool input schema crosses a JSON boundary, so date inputs are **strings**: `z.iso.date()` → `{type:'string',format:'date'}`, `z.iso.datetime()` → `{...,format:'date-time'}`. Never `z.date()` at the boundary. One trap: `z.date(...)` *with an argument* (e.g. `z.preprocess(str→Date, z.date({error}))`) is invisible to a `z.date()` grep — audit with `z\.date\(` (open paren, no close). When wrapping a domain whose schema still uses `z.date(...)`, convert it to `z.iso.datetime({error}).transform(v => new Date(v))` in the business schema (the app keeps receiving a `Date`; the boundary becomes a string), proven by the domain's existing tests staying green.

The **date-only variant** follows the same shape: a calendar-day input is an ISO `YYYY-MM-DD` string transformed to a local-midnight `Date` by a shared `isoDateSchema()` helper, placed in the business function's input schema itself — so app and MCP share one input shape instead of the tool patching around a `z.date()`.

### Booleans at the JSON boundary

A schema that only accepts a form string (`z.preprocess(v => v === 'true', z.literal(true))`, or the `'on'` checkbox coercion) silently rejects a native JSON `true`/`false` — which is exactly what an MCP client sends. A JSON boundary must accept **both**: widen the preprocess to `v => v === true || v === 'true'` (and `v === true || v === 'on'` for checkbox fields), keeping the `z.literal(true)` target. There is zero app behavior change — forms still post the string — and the widened schema now also crosses the boundary from a real boolean. When a wrapped tool carries such a field, add a test that JSON `true` (not `'true'`) reaches the business logic (it should fail on a business rule, not on input validation). Audit wrapped schemas with `=== 'true'` and `=== 'on'` (plus the `z\.date\(` grep above) — every coercion a form relies on is a boundary a machine client will hit as a native type.

### Jobs are not capabilities

A business function whose only effect is `someJob.enqueue(...)` is not itself the capability — the **user action that enqueues it** is (and that action already has, or will get, a tool). Never expose an `.enqueue` dispatcher as a standalone tool.

## Documents over MCP

Files never cross the JSON-RPC boundary as bytes. Every document flow splits into a metadata tool and a byte transfer the client performs itself against object storage.

**Reads — download-URL tools.** A browser download route streams a stored object (`redirect(await documentUrl(document))`). Turn it into a `*_url` tool by pushing the URL minting *into* the business function: it fetches the stored descriptor (bucket/key/filename/content-type), calls `documentUrl`, and returns `{ url }` (plus any metadata the route still needs); the route becomes `redirect(result.url)` — zero user-visible change. The tool is then a plain wrapped read (`<domain>_document_url`). `documentUrl` itself takes a raw bucket/key and is invoked only *inside* these business functions — no route calls it directly, so the parity walker never extracts it and it needs **no exemption**. If you ever reintroduce an inline route call, you reintroduce the extraction, and the right fix is to push the URL minting into the business function, not to add an exemption.

**Writes — `storage_upload_url` + a storage descriptor.** Domain writes that accept an uploaded file take a JSON storage-reference descriptor (`{ bucket, key, filename, contentType, sizeBytes }`), never the bytes. To make those usable without a browser, `storage_upload_url` takes `{ kind: 'document' | 'media', contentType, sizeBytes }` and mints a short-lived PUT URL into the caller's company store, returning `{ url, bucket, key }` with a company-scoped key (`<companyId>/<uuid>`, the same shape the byte route produces). The mint enforces the app's own constraints exactly, never anything broader: `contentType` must be in the same allowed set the byte route accepts for that kind and `sizeBytes` within the same cap, with the app's own violation messages — and the object-store backend signs **both** `ContentType` and `ContentLength` into the URL, so the store itself rejects any PUT whose bytes deviate. The client PUTs the bytes to `url`, then passes the returned `{ bucket, key }` (with the file's own filename/contentType/size) to a domain write tool, whose store-membership assertion re-checks the key is inside the caller's store. `storage_upload_url` is the canonical MCP-only transport primitive, listed in the exception register (see above); its business function mirrors the browser upload routes' guards exactly (company membership, the same scope, no extra permission, plus these type/size limits).

**Two exemption categories for byte streams.** The raw multipart byte-transport functions behind browser upload forms are parity exemptions — MCP clients upload through `storage_upload_url` and pass the returned reference to the domain tools. A route that streams bytes fetched live from an external system, with no stored object to presign for a stateless client, is an exemption too.

## Registry is accumulate-only

`registry.server.ts` is one import + one spread per domain — two lanes each add their own, and the union of both is correct. `parity-exemptions.ts` and `pending-coverage.ts` accumulate the same way. But resolving a rebase/merge conflict across these three manifests is **not** a uniform keep-both.

## Resolving manifest merge conflicts

Each manifest resolves a conflict its own way; a blind marker-strip corrupts two of them, and the parity test is the net that catches the mistake.

- **`registry.server.ts` — regenerate from the union, never marker-strip.** Rebuild the import block and the spread array from the union of the unique import lines and the unique spread entries across both sides, and assert the two sets match — every imported domain array is spread exactly once.
- **`pending-coverage.ts` — union of *removals*.** Each landed domain deletes its own entries, so drop every entry either side dropped, then run the parity test and re-add whatever it reports as uncovered: an entry one side *added* can sit inside a conflict block and be lost by the union-of-removals, and only the parity run surfaces it.
- **`parity-exemptions.ts` — keep both, then inspect the boundary objects.** Union both sides' entries, then read the two objects at the conflict boundary by hand: marker-stripping can fuse two adjacent object literals into a single duplicate-key object, silently dropping an exemption.

## Parity check (the same-PR DoD)

`parity.test.ts` uses the Babel AST to extract every business function a route module touches, by a **reference walk**: a business fn counts as route-invoked when the module holds ANY value reference to an identifier imported from `~/business/<module>.server` (or a non-computed member access on a namespace import of one), recorded as `module.exportName` and excluding names ending in `Context`/`Schema`. The walk skips `ImportDeclaration` subtrees (so the import binding itself never counts) and, on any other node, adds the reference the moment it resolves and stops descending. Five assertions: every extracted fn is **wrapped xor exempt xor pending**; no stale pending (already wrapped); no dangling `wraps` (fn no route invokes); never both exempt and pending; no duplicate tool names. The check also reads the exception register at `{{exception-register}}`: a tool standing outside the wrap rule that is not listed there fails the gate.

- **Wrapped** — a tool's `wraps` names it. This is the goal state for a user capability.
- **Exempt** (`parity-exemptions.ts`, `{ functionName, reason }`) — a machine surface that is *not* a user capability: the OAuth authorization-server functions, third-party webhooks and their dev fakes, browser-only auth redirects. A bogus exemption ("I didn't get to it yet") is a lie the reviewer must reject — exemptions are forever, for genuine non-capabilities only.
- **Pending** (`pending-coverage.ts`) — a real capability not yet wrapped. This list is the backlog; it shrinks to `[]` as domains land. Seed new entries by running the test once and copying the printed `uncovered` array.

**The DoD**: every new or changed app capability extends the MCP server *in the same PR*. Adding the function to `pendingCoverage`, or exempting it falsely, does **not** satisfy this — pending is only for capabilities a *different* lane will wrap, and CI's drift check merely stops silent gaps. The check is the mechanical floor; the standard reviews audit against is the parity standard at `{{parity-standard}}`, judged by outcome fitness, never endpoint existence.

The extraction has no const-assignment or dispatch-map blind spot: because it is a reference walk rather than an invoker-argument special-case, a business fn referenced anywhere in the route module counts — assigned to a local `const`, held in a dispatch/intent map, passed to `collect`/`map`, or invoked directly. There is no inline-composition requirement to work around the extractor; write the route however reads best.

## OAuth invariants (`oauth.server.ts`) — do not weaken

The authorization server is append-only and event-sourced like the rest of the schema. Hold these:

- **Everything hashed at rest.** Codes, access tokens, refresh tokens, client secrets are stored as `sha256` (`hashToken`); plaintext is returned exactly once at issuance. PKCE verify is constant-time.
- **PKCE mandatory, S256 only.** `validateAuthorizationRequest` rejects a missing challenge or any method but `S256`. PKCE + redirect_uri + resource are verified **before** the single-use burn, so an honest wrong-verifier retry does not burn the code.
- **Single-use by unique insert.** A second code exchange hits the `oauthAuthorizationCodeConsumptions.codeHash` UNIQUE and fails atomically; a code replay also **revokes the derived token family** (RFC 6749 §4.1.2). A refresh token is claimed exactly once (`oauthRefreshTokenConsumptions.consumedRefreshTokenHash` UNIQUE) **before** the new issuance is minted, so a lost claim never leaves an orphan issuance; a reused refresh is a theft signal → **revoke the whole family** (RFC 6819).
- **Audience bound at issuance.** `resource` is defaulted to `${publicAppUrl}/mcp` when the code is issued and carried through the family; `verifyAccessToken` + the `/mcp` route reject a token whose `resource` isn't this server.
- **One clock — the database clock.** Every expiry is seeded and compared with SQL `now()` (`sql\`now() + interval '1 hour'\``), never `new Date(Date.now()+ttl)`.
- **Session-bound.** Tokens carry `userSessionId`; `verifyAccessToken`'s `NOT EXISTS` against `userSessionRevocations` means signing out of the browser session kills every MCP token minted from it.
- **INSERT-only forever.** No `UPDATE`/`DELETE`, no sweeper job, no in-memory session store. Revocation, rotation, consumption are all rows. Growth is bounded by refresh cadence; the escalation path is range-partitioning `oauthTokenIssuances`, never deletion.

The stable public origin is `env().publicAppUrl` (issuer, audience, discovery), **not** `getBaseUrl(request)` — the issuer must be request-independent.

## Testing canon

Build context directly with `buildUserContext(userId, companyId, baseUrl)` (no request) and call `listTools`/`callTool`. Per wrapped domain, cover three shapes:

- **Visibility** — the tool is hidden without its permission, and hidden when its module is disabled.
- **Denial** — calling without scope returns "Tool unavailable"; a business-schema denial surfaces the exact app error message.
- **Happy path** — a real call writes the expected event row (`orders_approve` → an `orderApprovals` row) or returns real data.

Use the project's test fixtures for members, permission grants, and signed-in requests. For OAuth, drive the functions directly and assert the event rows. Every new user-facing OAuth surface (the consent screen) ships its dev-seed section and E2E in the same PR — the seed carries a stable demo bearer token for it.

**Proving a guard without weakening committed source.** When a mutation-proof would require neutering a committed `isAvailable` gate and that edit is refused as an access-control weakening, prove the guard through `callTool`'s tools-injection seam (`callTool({ …, tools })`) instead: assert the real tool denies, then pass an in-memory spread-copy of that same tool with `isAvailable` neutered and assert the copy stops denying. The committed source never changes, and because both assertions run the same tool object, a wrong-tool-name false green is ruled out too.

### Testing with a real client

Driving the server from an actual MCP client (Claude Code) exercises the OAuth handshake and the tool surface end to end. The mechanics that bite:

- Claude Code requests **every** scope in `scopes_supported` — there is no per-scope selection — so one consent from a staff user grants the whole surface at once.
- Headless runs print account-wrapper banner lines *before* the JSON, so parse the **last** result object, never the first line. Add `--output-format stream-json --verbose` to capture the exact `tool_use` inputs the model sent.
- `mcp login` needs a real TTY: run the browser-mode login inside a PTY (`script -q …`) and drive the printed authorize URL with agent-browser.
- Give the model exact "use these arguments verbatim" instructions so the tool calls are deterministic.
