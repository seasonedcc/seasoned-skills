---
name: env-vars
description: Manage environment variables following the two-tier env pattern. Use when adding new env vars, modifying env schemas, working with app/framework/env.server.ts or app/env.server.ts, or updating CI env configuration.
---

# Environment Variables

Environment variables follow a **two-tier pattern**: a framework env for framework-only vars, and an app env for all vars (framework + app-specific).

## Architecture

### Framework Env — `app/framework/env.server.ts`

Contains only vars used by framework code (database, sessions, flash, email). Framework files (`db.server.ts`, `sessions.server.ts`, `flash.server.ts`, `email.server.ts`) import `env` from `./env.server` using a relative path.

### App Env — `app/env.server.ts`

Contains **all** vars (framework vars duplicated + app-specific vars). Imports `makeTypedEnv` from `make-typed-env` and defines its own schema.

App code (`app/business/`, `app/routes/`, `app/email.server.tsx`, `app/test/`) imports `env` from `~/env.server`.

### Why Two Independent Singletons

Each `env()` function parses `process.env` independently via its own `makeTypedEnv` instance. They do not share state. This keeps the framework folder self-contained — it validates only what it needs, and the app validates everything.

## Validated at Boot

Both `env()` functions validate lazily: the first call inside a request handler is what parses `process.env`. On its own that turns a missing variable into an outage rather than a failed deploy — the server starts, logs that it is running, and then answers every request, health probes included, with `Environment validation failed`.

`assertEnvironment()` in `server/app.ts` closes that. It validates both schemas against `process.env` and throws naming every variable that is missing or invalid, once each even when both schemas require it. `server.js` calls it before `app.listen` — on the built bundle in production and through Vite in development — prints the message, and exits 1. A server that cannot serve never accepts traffic.

So a newly required variable has to reach every environment that boots the server before the code requiring it runs there: `.env`, `.env.test`, the CI workflow, and the production host's app settings.

## Adding a New Env Var

### App-specific var (e.g., a new API key)

1. Add the Zod field to the app's `app/env.server.ts` only
2. Add the value to `.env`, `.env.test`
3. Add the value to the CI workflow in `.github/workflows/ci.yml`
4. Add the value to the production host's app settings before the release ships — the project's deploy docs cover where
5. Import `env` from `~/env.server` in the consuming file

### Framework var (e.g., a new database option)

1. Add the Zod field to **both** `app/framework/env.server.ts` and `app/env.server.ts`
2. Add the value to `.env`, `.env.test`
3. Add the value to the CI workflow in `.github/workflows/ci.yml`
4. Add the value to the production host's app settings before the release ships — the project's deploy docs cover where
5. Framework files import from `./env.server` (relative); app files import from `~/env.server`

## Import Conventions

```typescript
// Framework code (inside app/framework/)
import { env } from './env.server'

// App code (anywhere in app/ outside the framework folder)
import { env } from '~/env.server'
```

Never import `env` from `~/framework/env.server` in app code — that singleton only contains framework vars and will be missing app-specific fields.

## CI Environment Variables

The CI workflow lives at `.github/workflows/ci.yml`. Env vars go in the `env:` block at the job level.

Use placeholder values for services not exercised in CI (e.g., `'placeholder'` for API keys, `'["1.1.1.1"]'` for JSON configs).

## The `makeTypedEnv` Factory

Provided by the `make-typed-env` npm package:

```typescript
import { makeTypedEnv } from 'make-typed-env'
import { camelKeys } from 'string-ts'
import { z } from 'zod'

const getEnvironment = makeTypedEnv(
  z.object({ /* ... */ }),
  { transform: camelKeys },
)
const env = () => getEnvironment(process.env)
```

- Schema-agnostic (supports any Standard Schema — Zod, Valibot, ArkType, etc.)
- Accepts an optional `transform` parameter — we pass `camelKeys` from `string-ts` to convert `SNAKE_CASE` to `camelCase`
- Caches only when passed `cache: true`, which we do not pass — every `env()` call re-validates `process.env`
- Each call to the factory creates an independent instance — framework and app singletons don't interfere

## Schema Duplication

Framework vars appear in both schemas. This is intentional — the framework folder and app are decoupled. If a framework var's validation changes (e.g., a new default), update both files.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/env-vars.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
