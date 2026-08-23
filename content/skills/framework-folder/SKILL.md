---
name: framework-folder
description: Enforce separation between framework and app code in the framework folder. Use when adding new files or logic to the framework folder, importing framework modules, or deciding where to place new abstractions.
---

# Framework Folder

The `{{app-root}}/framework/` folder must contain **zero app-specific logic**. It should be self-contained enough to extract as a separate npm package at any time.

## What Belongs in `{{app-root}}/framework/`

Only reusable abstractions that apply across any app built on this framework:

- Database connection and helpers (`db.server.ts`)
- Session management (`sessions.server.ts`)
- Flash messages (`flash.server.ts`)
- Email transport setup (`email.server.ts`) — the `makeSendEmail` factory, not app-specific email config
- Environment variable utilities (`env.server.ts`) — the `makeTypedEnvironment` factory and framework-only env schema
- Route controller helpers (`controllers.server.ts`) — `act()`, `load()`
- Auth utilities (`auth.server.ts`)
- Background job utilities (`worker.server.ts`) — `makeJob`, `makeCronJob`

## What Does NOT Belong in `{{app-root}}/framework/`

- App-specific environment variables (e.g., `SENDGRID_API_KEY`, `GOOGLE_*`, `AWS_*`)
- App-specific business logic or domain models
- App-specific configurations (e.g., SMTP credentials, S3 bucket names)
- Anything that references `{{app-root}}/business/` or app-specific modules

## Import Direction

The dependency flow is strictly one-directional:

```
{{app-root}}/business/   → imports from → {{app-root}}/framework/
{{app-root}}/routes/     → imports from → {{app-root}}/framework/
{{app-root}}/email.server.tsx → imports from → {{app-root}}/framework/

{{app-root}}/framework/  → NEVER imports from → {{app-root}}/business/, {{app-root}}/routes/, or app-level files
```

Framework files may import from each other using relative paths (`./env.server`).

## The Factory Pattern

When framework code needs app-specific configuration, expose a factory function that the app calls with its own config:

```typescript
// {{app-root}}/framework/email.server.ts — framework provides the factory
function makeSendEmail(config: SMTPTransport.Options & { maildevPort: number; maildevWebPort: number }) {
  // ... generic email sending logic
}

// {{app-root}}/email.server.tsx — app provides specific config
const sendEmail = makeSendEmail({
  maildevPort: 1027,
  maildevWebPort: 1082,
  host: 'smtp.sendgrid.net',
  // ...
})
```

## Litmus Test

Before adding anything to `{{app-root}}/framework/`, ask:

1. Would another app built on this framework need this?
2. Does it reference any app-specific modules or env vars?
3. Could this be published as part of a standalone npm package?

If the answer to #1 is no, or #2 is yes, or #3 is no — it belongs in `{{app-root}}/` or `{{app-root}}/business/` instead.
