---
name: business-folder
description: Organize business logic in app/business/ by domain cohesion and framework independence. Use when creating files in app/business/, adding functions to business files, naming business modules, deciding where to place business logic, or choosing what to import in business code.
---

# Business Folder

The `app/business/` folder holds the most valuable code in the application — the domain logic that defines what the product does. Frameworks, routers, and UI libraries come and go, but business logic outlives them all.

The guiding question: **If the framework were replaced tomorrow, could the business folder come along unchanged?**

Every file must be named after the **business domain** it serves, every function must belong to that domain, and the code must stay independent from framework-specific concerns.

## Framework Independence

Business functions must not import from `~/framework/*.server` or from `react-router`. These dependencies tie domain logic to the current framework and make it impossible to extract.

### What belongs in business files

- **Third-party domain libraries** — `composable-functions`, `zod`, `kysely`, AI SDKs, `fuzzball`, etc.
- **Database access** — `~/db/db.server` (Kysely is framework-agnostic)
- **Environment config** — `~/env.server` (Zod-validated, no framework dependency)
- **Other business files** — `./auth.server`, `./s3.server`, etc. (respecting the no-cross-imports rule)

### What belongs in routes or controllers

- `redirect`, `Params`, or any import from `react-router`
- `setFlashMessage`, `getAuthenticatedContext`, `throwRedirect` from `~/framework/*.server`
- Session handling, cookie manipulation
- HTTP response construction

### Acceptable framework wrappers

Two thin wrappers are acceptable because they bridge domain logic to infrastructure without coupling to the web framework:

- **`makeJob` / `makeCronJob`** from `~/framework/worker.server` — job scheduling is a business concern; these wrap graphile-worker without importing react-router
- **`fetchList`** from `~/framework/db.server` and **`makeListInput`** from `~/framework/schemas` — pure Kysely pagination helpers with no framework dependency

### The auth exception

`auth.server.tsx` is the one file that bridges the framework and the business layer. It imports from `react-router` and `~/framework/*.server` because it must — it handles sessions, redirects, and flash messages. This coupling is contained: the rest of the business layer imports only the **Zod context schemas** it exports (`userContextSchema`, `contextSchema`, etc.), not its framework-coupled functions. Keep it that way.

## Naming Rule

Name files after the business domain, not the implementation detail.

```
✅ projects.server.ts      — domain: project management
✅ collections.server.ts   — domain: collection management
✅ auth.server.tsx          — domain: authentication

❌ gemini.server.ts         — named after AI provider, not the domain it serves
❌ openai.server.ts         — same problem: provider name, not business domain
```

### Infrastructure Exception

Files providing **generic infrastructure primitives** may be named after their provider, because the provider *is* their domain — they wrap a service API without embedding business-specific logic:

```
✅ s3.server.ts             — generic S3 upload/download/delete/copy
✅ google-drive.server.ts   — generic Drive search/download/upload
✅ mistral.server.ts        — generic OCR invocation primitives
```

The test: if the file contains prompts, schemas, business rules, or domain-specific processing logic, it belongs in a domain-named file — even if all its functions call the same external API.

## File Suffixes

- **`.server.ts`** — Server-only business logic (database queries, API calls, jobs)
- **`.server.tsx`** — Server-only files that export React components (e.g., email templates in `auth.server.tsx`)
- **`.common.ts`** — Shared schemas and types usable on both client and server
- **`.ui.tsx`** — Client-side React components with hooks for a business domain
- **`.client.ts`** — Browser-only utilities (e.g., localStorage helpers)
- **`.email.server.tsx`** — Email-sending jobs with JSX email templates, using `makeJob`
- **`.test.ts`** / **`.server.test.ts`** / **`.common.test.ts`** / **`.ui.test.tsx`** — Unit tests, placed alongside the implementation file

## Cohesion Rule

Every function in a file must belong to that file's business domain. If a function serves a different domain, move it to the appropriate file.

Signs of poor cohesion:
- A file named after an AI provider but containing business logic about projects
- Functions in a file that are only consumed by a single other domain
- A file whose functions don't relate to each other except by implementation detail

## No Cross-Imports

Business files must not create circular dependencies:

```
✅ tasks.server.ts    → imports from → projects.server.ts
❌ projects.server.ts → imports from → tasks.server.ts
```

If two files need to share a utility, options in order of preference:
1. **Merge the files** if they serve the same domain
2. **Keep a private copy** in each file if the utility is small and trivial
3. **Extract to a new file** only if the utility is substantial and shared by 3+ files

## When to Merge vs Split

**Merge** when files serve the same business domain — even if they use different external APIs internally. The AI provider or library used is an implementation detail, not a reason to separate files.

**Split** when a file grows to cover distinct business domains. The right boundary is the domain, not the file size.

## Promoting seed logic to production

Dev-seed logic promoted to a production path must be re-derived under production invariants, never moved wholesale. Seed conveniences — grant-every-permission, assign-every-member — are deliberate shortcuts that become privilege escalations the moment a production path re-runs them against real data. Provision the specific role and assign only the intended member; never reuse the seed's fan-out.

## Litmus Test

Before creating or modifying a business file, ask:

1. **Could this file survive a framework migration?** If the framework were replaced, would this file need changes beyond swapping the job runner or database library?
2. Does the name describe the **business domain** (what it does) rather than the **implementation** (how it does it)?
3. Do all functions in this file belong to the same business domain?
4. Would someone unfamiliar with the codebase find this function in this file based on the filename?
5. Does this file import from `react-router` or `~/framework/*.server`? If so, is it `auth.server.tsx` or using an acceptable wrapper (`makeJob`, `makeCronJob`, `fetchList`, `makeListInput`)?

If the answer to any question is wrong, the file needs changes.
