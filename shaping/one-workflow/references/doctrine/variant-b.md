# The app

An operations platform — production, inventory, procurement, and sales in one place, multi-company by design. Built on React Router v7, Kysely ORM, and graphile-worker, with a self-contained framework layer in `app/framework/`.

## The append-only doctrine

The application schema is 100% append-only and event-sourced, with zero exceptions: `INSERT` is the only write, current state is derived from events at query time, and deletion/archival/correction are events too. ALWAYS load the `database-design` skill before designing tables, writing migrations, or writing any query that changes data. The `kysely` skill covers the query-side rules (`updateTable`/`deleteFrom`/`doUpdateSet` are banned on application tables).

## Market research

The market research guiding our positioning lives in the `market-research` skill, which also codifies the audience and positioning we've locked in.

## Internal admin

Company-internal operations live in the in-app Staff Admin at `/staff-admin`, gated by staff roles. Org provisioning is guided there step by step, and support operations run against the same surface.

## Plans and billing

The product sells self-serve plans through Stripe. The plan registry in `app/business/plans.common.ts` is the single source of truth — its plan ids, prices, seat caps, and module sets are founder decisions, not up for change. ALWAYS load the `billing` skill before working on plans, subscriptions, checkout, billing, or module entitlements.

## Integrations

Every call the product makes to an outside system — Odoo, QuickBooks, Stripe, the mail server — records its request and its outcome append-only, customer surfaces derive live status from those events and speak in mapped copy with a concrete next action, and raw vendor detail lives only in Staff Admin. ALWAYS load the `integration-telemetry` skill before adding or changing any integration operation: a sync, push, pull, webhook, connection test, token refresh, or vendor cron job.

## Essential Development Commands

**Setup & Dependencies:**
```bash
pnpm install                    # Install dependencies
pnpm run build                  # Build the app
```

**Development:**
```bash
pnpm run dev                    # Run the app with hot reload (app on :7002, maildev UI on :1087)
pnpm run dev:worker             # Run the graphile-worker process (needed for auth emails)
pnpm run lint                   # Check code style with Biome
pnpm run lint-fix               # Auto-fix linting and formatting issues
pnpm run tsc                    # Type-check
```

**Database Operations:**
```bash
pnpm run db:migration "Name"    # Create new migration file
pnpm run db:migrate             # Run migrations and regenerate types
pnpm run db:rollback            # Rollback last migration and regenerate types
pnpm run db:seed:dev            # Seed a freshly created, empty development database
```

**Testing:**
```bash
pnpm run test                       # Run all tests (unit + E2E)
pnpm run test:unit                  # Run all unit tests
pnpm run build && pnpm run test:e2e # Always build before E2E tests
```

## Tooling

- **Package manager:** `pnpm` (version 10.x). Install dependencies with `pnpm install` from the repo root.
- **Shell scripting:** never rely on shell-specific constructs like bash's `${PIPESTATUS[0]}` — the shell varies by environment, and such constructs can silently no-op elsewhere. When a piped command's success matters, echo each step's exit code explicitly (`cmd | tail -5; echo "exit=$?"` reports tail's status, not cmd's) or avoid the pipe.
- **Node version:** `^22.22.0`.
- **Linting & formatting:** [Biome](https://biomejs.dev). Check with `pnpm run lint` and auto‑fix with `pnpm run lint-fix`.
- **Type checking:** `pnpm run tsc`.
- **Tests:** Vitest for unit tests and Playwright for E2E tests. Run with `pnpm run test`.
- **Build:** `pnpm run build`.
- **Dev:** `pnpm run dev`.
- **Claude Code:** on this machine it runs per-project — use `claude-app` (a zsh function, so from scripts invoke it as `zsh -ic 'claude-app …'`); bare `claude` is unauthenticated.

The workflow file `.github/workflows/ci.yml` shows the exact CI steps for type‑checking, linting, testing, and docs screenshot signature verification — a PR that changes what a documented screen shows fails CI until its screenshots are recaptured (the docs-writing skill covers the pipeline).

### TypeScript Guidelines

- **TYPE OVER INTERFACE**: Use `type` instead of `interface` when possible (prefer type aliases)
- **TYPE INFERENCE**: Use TypeScript's inference where possible, but define types for component props
- **MINIMAL ANNOTATIONS**: Only add types when required by strict mode or for clarity
- **STRICT MODE**: All TypeScript features enabled for maximum safety
- **GENERIC INFERENCE**: Design generics to be inferred from parameters
- **NO ANY**: ALWAYS Avoid `any` - proper types instead, or use `unknown` as a last resort
- **AVOID RETURN TYPES**: DO NOT ADD RETURN TYPES to functions unless strictly necessary

For comprehensive type-safety guidelines, load the `type-safety` skill.

## Testing

For comprehensive testing guidelines, patterns, and examples, load the `testing` skill. This skill covers unit testing with Vitest, E2E testing with Playwright, database testing patterns, React Router testing with createRoutesStub, test organization, and TDD workflows.

The full E2E suite runs on the PR's CI, never locally — this applies to every agent, subagents included, and no charter may require it. Open the PR once the fast gates (`pnpm run lint`, `pnpm run tsc`, `pnpm run test:unit`) pass and treat the CI E2E job as the acceptance gate, fixing any red on the branch. Locally, run at most the specs a change directly touches (`pnpm run build && pnpm run test:e2e tests/<spec>.spec.ts`), and reserve a full local run for debugging a CI failure that resists spec-level reproduction. A change to the seed or the E2E runner touches every spec, so there the full suite is the directly-touched set.

## Coding style

- NEVER add backwards compatibility to plans or implementations unless explicitly required. This only makes our codebase unnecessarily complex.
- Do not add comments to the code unless it's an incredibly complex operation
- ALWAYS use the `href` helper for type-safe routing. NEVER use relative paths or string interpolation/concatenation.
- Source files are mostly TypeScript ESM modules.
- Formatting is handled by Biome. It enforces:
  - 2 space indentation.
  - Single quotes.
  - Trailing commas where valid.
  - Semicolons only when required (`semicolons: "asNeeded"`).
- Use dynamic `import()` calls only when strictly necessary, such as for
  environment specific modules or code splitting.
- Avoid abbreviations when naming things. That goes for SQL statements as well.
- Avoid Hasty Abstractions: it is OK to repeat things here and there until the right abstraction emerges.
- Only extract new components if you need to reuse it or call hooks. Otherwise, write the markup in the same existing component.
- Only extract abstractions to new files if you need to share them among more than one file. Otherwise, extract them in the same file.
- If it can be done in a single Kysely query, do it. Only manipulate database data on Node if you can't do it in SQL.
- Run `pnpm run lint-fix` before committing to ensure formatting and import ordering.

## Business Logic Organization

- `app/business/` contains domain functions with `.server.ts`, `.common.ts`, and `.test.ts` files. Load the `business-folder` skill for details.
- Functions use `applySchema()` with context validation for authorization
- **No cross-imports** between business files to prevent circular dependencies. For example, if `app/business/results.server.ts` imports from `app/business/auth.server.tsx`, then `auth.server.tsx` cannot import anything from `results.server.ts`.

Maildev runs during development for email preview.

## Authorization

For implementing authorization patterns, load the `authorization` skill. This skill covers context getters, context schemas, and the three-layer authorization architecture.

## Env vars

- Environment variables are defined in `app/env.server.ts` (app-level) and `app/framework/env.server.ts` (framework-level). Load the `env-vars` skill for working with env vars.

## Database migrations and DB types

- Do not update `app/db/types.d.ts` directly, only by running new migrations.
- Always run `pnpm run db:migration The name for the migration` to create new migration files.
- Always run `pnpm run db:migrate` to run migrations.
- Use camelCase for names when using Kysely in migrations. We have a Kysely plugin that will convert them to snake_case when compiling the query. The only times you write with snake_case is when writing raw SQL.
- Only create irreversible migrations as a last resort, when all other possibilities where considered.
- Unless the migration is irreversible, run `pnpm run db:migrate` to test the migration and then `pnpm run db:rollback` to test the rollback before running `pnpm run db:migrate` again for final application.
- The dev seed is empty-database-only. The pipeline (`app/db/dev-seed/pipeline.ts`, behind the thin `seed.ts` entrypoint) runs `assertDevelopmentDatabase()` then `assertEmptyDatabase()` before any section, aborting unless the target database name ends with `_development` and every application table is empty. There is no idempotency machinery — no "already seeded" guards, no per-natural-key convergence; each section assumes a blank database and only inserts.
- There is deliberately no db reset script. Because the seed only builds onto an empty database, reseeding is a manual drop, recreate, migrate, seed — every run is a complete build from a known-clean slate, never a patch over existing rows.
- `pipeline.ts` is the ordered orchestrator, with one file per surface under `app/db/dev-seed/`. A section's prerequisite lookup must throw naming the missing key, never fall back to a default like `?? ''` — a blank-database run has no earlier state to lean on.
- A feature that ships a new user-facing surface ships its dev-seed section and its seed manifest coverage in the same PR — the Definition of Done spells out the full rule.
- Rows the app sorts or compares by a date must all get that date from one scheme within the seed — either every one now()-relative (`companyDate(n)`) or every one a fixed calendar date, never a mix. A relative date drifts one day per day until it crosses a fixed neighbor, reordering the surface, and on the crossing day the two tie — leaving the order to random per-seed UUIDs. Both failure modes surface as docs screenshot DOM-signature drift on whatever day the calendar reaches the collision, far from the PR that planted it. Reserve now()-relative dates for rows whose demo value is recency (activity feeds, "received last week"), and use fixed dates for anything that participates in an ordering, like lot expirations sorted FEFO. A fixed date the app compares against now() — a due/overdue/expiring window, a "needs attention within N days" badge — changes state on a knowable calendar day, so pick it to keep that state constant forever: decades out for never-due, firmly in the past for a deliberately overdue demo, never inside or approaching the window.

## Fixing Bugs

When addressing a bug, follow a test-driven development approach:

1. **Red** – Write a test that reproduces the issue and fails.
2. **Green** – Implement the minimal fix so the new test passes.
3. **Refactor** – Clean up the solution while keeping all tests green.

## Framework concepts

**Route Structure:**
- Uses React Router v7 with config-based routing at `app/routes.ts` (REMEMBER to update `routes.ts` when changing routes)
- Loaders use `load()` helper with context validation
- Actions use `act()` helper for form processing

**Composable Functions:**
- Business logic uses `composable-functions` library
- Schema validation with `applySchema(inputSchema, contextSchema)`
- Context passing ensures authorization at every layer

**Framework folder:**
- Reusable abstractions live in `app/framework/`. Load the `framework-folder` and `business-folder` skills for deciding where to save a new abstraction.
- Server-only files end in `.server.ts` / `.server.tsx`. Universal files do not.

## Quality bar

We care a lot about beautifully simple UI/UX. Always ensure our UX/UI is outstanding and follows our design system. We care even more about code quality. Please ensure our code is a work of art, always as simple as it can be, with the right domain language and prose. NEVER compromise on this quality bar to save time or tokens.

## Worktrees

Independent tasks run in isolated git worktrees, each with its own databases, ports, env files, and dev server. Use `pnpm run worktree:setup <lane>` / `pnpm run worktree:teardown <lane>`, and load the `worktrees` skill for the lifecycle, naming conventions, and guardrails.

ALWAYS work in an isolated worktree unless told otherwise.

## Testing with agent-browser

Load the `agent-browser` skill to test your work end to end with a browser. ALWAYS test your work end to end with `agent-browser`.

Sweep leaked browser processes with `pnpm run browser:sweep` before and after every browser-using run, and clear the survivors it lists with `pnpm run browser:sweep --kill` — leaked browsers exhaust this machine's memory and poison unrelated Playwright runs. NEVER kill browsers by pattern: `pkill -f` and its relatives fire at processes nobody inspected, including permanently running services on this machine.

## Orchestration

These instructions are for the top-level session — the orchestrator. If you are a subagent (you were spawned with a specific task and your final report goes back to a coordinator), they are not addressed to you: execute your task directly — read, build, and test yourself — and never spawn subagents, launch workflows, open PRs, or merge unless your task instructions explicitly say to.

Act as the orchestrator on every task, not just during `/goal` loops. Delegate execution to subagents and dynamic workflows and keep your own context lean: subagents do the heavy reading, building, and testing, and report conclusions back — don't read what a subagent can read for you.

Load the `subagents` skill before spawning subagents or dynamic workflows — it covers which model tier and reasoning effort to use for each kind of work and how to split tasks. Load the `orchestration` skill alongside it — it covers charters, verifying subagent claims, recovery after interruptions, and shipping lane PRs. Size every subagent task so its context lands at roughly one-third of the 1M-token window by completion, since these models start degrading past ~25–33% fill.

Break the work down however you think is best, as long as you respect dependencies: work that depends on other work only starts when the dependency has fully landed. Independent work runs in parallel, each piece in its own worktree. Use well-designed dynamic workflows whenever the work allows for parallelism.

Our baseline is all checks passing: tsc, lint, tests, etc. Whenever that baseline gets lost for any reason, stop everything and restore the baseline with the highest quality level. The baseline also includes the integrity of the checks themselves: a guard that cannot see what it claims to protect, a coverage hole a suite cannot notice, or seeded state scheduled to diverge from the product is a baseline loss even while CI is green. Fix such gaps immediately upon discovery — never bank them as findings or file them as issues.

Long tasks get compacted several times, so keep a scratchpad ledger file with all the durable lessons and state you'll need after compaction. Keep it current at every moment, never deferring updates until the window fills: the user monitors your context from outside and initiates compaction, which can land at any point without warning, so never ask for one. NEVER trust your compacted context. Always reground yourself on the ledger and the real sources of truth: our codebase, PRs, prototypes, etc.

When the user asks a question, answer that question directly before anything else, and change nothing as a side effect of answering — no lane interventions, no fixes, no messages to agents. If the answer reveals something worth acting on, propose the action and wait for the ruling.

When you need the user's input, ask in regular conversation, and keep working on whatever doesn't depend on the answer. Ask exactly one question per message and wait for the answer — never bundle multiple questions, even related ones. The same rule governs guided manual work: when walking the user through steps they perform themselves, send exactly one step per message and wait for their confirmation before sending the next.

When presenting a finding, bug, or proposal to the user, explain the problem first — what actually goes wrong, for whom, and why it matters — and only then the solution. A recommendation whose problem hasn't been established reads as noise and cannot be evaluated.

## Working with /goal goals

A `/goal` goal follows the same orchestration approach as everything else. The one difference: a goal allows multiple PRs to be merged during development, against the goal's base branch — `main` unless the goal says otherwise. As you personally review each PR, feel free to merge it to the base branch when you consider it ready. The only rule is not to merge broken work.

Goal copy drafted for the user to set must come in under /goal's 4,000-character limit. After a context compaction mid-goal, re-read the full active goal text before resuming work — a compacted summary of the goal is not the goal, and the goal's own instructions outrank the ledger's shorthand.

During `/goal` loops, ask for the user's input through questionnaire questions instead of regular conversation — the questionnaire is the only tool that makes the goal-checker agent stop. If you ask through regular text and the user is not around at that point in time, the goal-checker agent will prompt you to continue working until you reach the goal and your message will be lost.

When the goal is met, load the `self-improvement` skill and run it once over the whole effort's record before marking the goal complete.

## Definition of Done

- A task is not done unless `pnpm run lint`, `pnpm run tsc`, and `pnpm run test:unit` are all passing.
- A task is not done if it adds or changes an app capability without extending the MCP server in the same PR, guarded by the parity check. Load the `mcp-server` skill: wrap the new or changed business function as a tool. Deferring it into `pending-coverage.ts` or dressing it up as a parity exemption does NOT satisfy this — pending is only for capabilities another lane owns, and exemptions are for genuine machine surfaces, not unfinished work.
- A task is not done if it adds, changes, or removes a user-facing product surface or capability without updating the docs in the same PR. Load the `docs-writing` skill and hold its full quality bar: each new or substantially rewritten article gets its own context window as the skill instructs, and even a small edit follows the skill's voice and fact-check-against-the-live-product rules. Words, steps, and screenshots must match the shipped UI, and the coverage manifest in `app/content/docs/coverage.ts` must stay truthful — a new surface ships `documented` in the same PR, or `exempt` with an honest reason when it is genuinely not a product surface; leaving it `planned` does NOT satisfy this. University content is deliberately outside this rule — no product PR is required to touch it.
- A task is not done if it adds or changes a user-facing product surface without shipping its dev-seed section and matching coverage in the seed manifest suite (`app/db/dev-seed/manifest/manifest.seed-test.ts`, run with `pnpm run test:seed`) in the same PR. Every surface either seeds its demo-critical state — asserted by the suite, which runs the real migrate-and-seed pipeline against a throwaway database in CI — or is declared in the suite's `declaredUnseedable` list with an honest written reason; a surface is never silently omitted. The suite only fails when a covered surface's demo state is missing — unlike the MCP parity check, it cannot notice a surface nobody covered — so adding the coverage is this criterion's review-time requirement. Keep the dev seed single-shot and fail-loud behind its preflight guards: never reseed a populated database and never add a reset script — to reseed, drop and recreate the database.
- A task is not done if it changes a user-facing flow without a Playwright spec covering the changed behavior — a new spec, or an existing one updated to assert it — and without every route the flow touches reaching the E2E coverage gate as covered. The gate (`tests/coverage/gate.ts`) fails a full run that leaves a route unreached; parking a route in `tests/coverage/pending.ts` is explicit debt its feature settles before it is done, and an exclusion needs a written rationale citing the unit test that owns the behavior. Load the `testing` skill for the conventions.
- A task is not done if it has leftover comments. ALWAYS remove leftover comments before finishing. Our work should NOT add comments unless it's an incredibly complex operation.
- A task is not done if it has not passed a `code-review` skill audit based on your judgement. Do not take the subagent suggestions at face value. Loop until YOU are satisfied with the quality.
- A task is not done if you haven't tested it end to end with `agent-browser`, took screenshots, and validated its design as well as its functionality.
- A task is not done if it changes user-facing UI without holding the responsive bar on every changed surface: 360×740, 375×667, 768×1024, 1024×768, 1280×800, and 1440×900, plus 150%-zoom emulation of the phone and tablet sizes (dimensions ÷1.5 — 240×493, 250×445, 512×683, 683×512). The bar is journey-level, not per-screenshot: a phone user completes the task without being worse off than on desktop. That means `document.documentElement.scrollWidth === window.innerWidth` EXACTLY at every size, overlays and menus clamping on-canvas, rows wrapping or stacking instead of squeezing, no content hidden on mobile that desktop shows, no hover-only information or desktop-only affordances on touch, primary actions full-size below `xl` per the design-system skill's responsive canon, human text wrapping at word boundaries, and deliberate typography and spacing at every size. Verify with `agent-browser` screenshots of every changed surface at the affected sizes, and review them as actual images — a numeric probe passing does not close the criterion.
- After every other criterion passes, load the `self-improvement` skill: derive the task's lessons and open self-improvement PRs for the ones worth codifying. Never merge these PRs — the user reviews and merges them personally. Finding nothing to codify is a valid outcome. Tasks inside a `/goal` goal skip this step — the goal runs a single self-improvement pass when it is met.

## Additional warnings

- DO NOT change dependency arrays just to make the linter happy or to follow React "best practices". You'll create infinite render loops. Only add things to dependency arrays when they really need to be there.
