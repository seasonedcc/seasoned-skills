# The Product

The app is built on React Router, Kysely ORM, and graphile-worker, with a self-contained framework layer in `apps/web/app/framework/`.

The repository is a pnpm-workspaces + Turborepo monorepo. The web app lives in `apps/web` (package `@app/web`); the native mobile shell lives in `apps/mobile` (`@app/mobile`, an Expo app that wraps the web app in a WebView); shared packages such as the web↔shell bridge live under `packages/*` (`@app/bridge`). All commands below run from the repo root — root scripts delegate to the web workspace through Turborepo (`build`, `dev`, `tsc`, `test`, `test:unit`, `test:e2e`) or `pnpm --filter @app/web` (the `db:*`, `dev:worker`, and worktree commands). `lint`/`lint-fix` run Biome directly at the root over the whole repo.

## Essential Development Commands

**Setup & Dependencies:**
```bash
pnpm install                    # Install dependencies
pnpm run build                  # Build the app
```

**Development:**
```bash
pnpm run dev                    # Run the app with hot reload
pnpm run lint                   # Check code style with Biome
pnpm run lint-fix               # Auto-fix linting and formatting issues
pnpm run tsc                    # Type-check
```

**Database Operations:**
```bash
pnpm run db:migration "Name"    # Create new migration file
pnpm run db:migrate             # Run migrations and regenerate types
pnpm run db:rollback            # Rollback last migration and regenerate types
```

**Testing:**
```bash
pnpm run test                       # Run all tests (unit + E2E)
pnpm run test:unit                  # Run all unit tests
pnpm run build && pnpm run test:e2e # Always build before E2E tests
```

## Tooling

- **Package manager:** `pnpm` (version 10.x). Install dependencies with `pnpm install` from the repo root. `pnpm install` may rewrite `package.json` formatting in a way Biome rejects — if it ran after your last lint, run `pnpm run lint` (or `lint-fix`) again before reporting gates green.
- **Shell scripting:** never rely on shell-specific constructs like bash's `${PIPESTATUS[0]}` — the shell varies by environment, and such constructs can silently no-op elsewhere. When a piped command's success matters, echo each step's exit code explicitly (`cmd | tail -5; echo "exit=$?"` reports tail's status, not cmd's) or avoid the pipe. Also remember zsh does not word-split unquoted variable expansions: `git diff -- $PATHS` with a space-separated list in `$PATHS` passes ONE pathspec that matches nothing, and the silently-empty output can read as a clean verification — write the paths out literally or use an array.
- **Node version:** `^22.22.0`.
- **Linting & formatting:** [Biome](https://biomejs.dev). Check with `pnpm run lint` and auto‑fix with `pnpm run lint-fix`.
- **Type checking:** `pnpm run tsc`.
- **Tests:** Vitest for unit tests and Playwright for E2E tests. Run with `pnpm run test`.
- **Build:** `pnpm run build`.
- **Dev:** `pnpm run dev`.

The workflow file `.github/workflows/ci.yml` shows the exact CI steps for type‑checking, linting and testing.

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
- When naming clinical domain concepts, start from the official terms in the international healthcare standards (FHIR resources, LOINC, UCUM). The product is deliberately not FHIR-compliant, and we deviate whenever our own product language serves users better (e.g. `customers`, not FHIR's `Patient`) — but a deviation must be a conscious choice, never ignorance of the official name. The pattern lives in the `database-design` skill; deliberate deviations are recorded in the Domain Language section of `architecture.md`.
- Avoid Hasty Abstractions: it is OK to repeat things here and there until the right abstraction emerges.
- Only extract new components if you need to reuse it or call hooks. Otherwise, write the markup in the same existing component.
- Only extract abstractions to new files if you need to share them among more than one file. Otherwise, extract them in the same file.
- If it can be done in a single Kysely query, do it. Only manipulate database data on Node if you can't do it in SQL.
- When the user shares another organization's work (a PR, a repo, a pattern) as inspiration, never mention that source in anything visible in this repo — PR bodies, commit messages, code, comments, or issues. Describe the resulting change entirely on its own terms; the reference lives only in the conversation.
- Run `pnpm run lint-fix` before committing to ensure formatting and import ordering.

## Business Logic Organization

- `apps/web/app/business/` contains domain functions with `.server.ts`, `.common.ts`, and `.test.ts` files. Load the `business-folder` skill for details.
- Functions use `applySchema()` with context validation for authorization
- **No cross-imports** between business files to prevent circular dependencies. For example, if `apps/web/app/business/results.server.ts` imports from `apps/web/app/business/auth.server.tsx`, then `auth.server.tsx` cannot import anything from `results.server.ts`.

Maildev runs during development for email preview.

## Authorization

For implementing authorization patterns, load the `authorization` skill. This skill covers context getters, context schemas, and the three-layer authorization architecture.

## Env vars

- Environment variables are defined in `apps/web/app/env.server.ts` (app-level) and `apps/web/app/framework/env.server.ts` (framework-level). Load the `env-vars` skill for working with env vars.

## Database migrations and DB types

- Do not update `apps/web/app/db/types.d.ts` directly, only by running new migrations.
- Always run `pnpm run db:migration The name for the migration` to create new migration files.
- Always run `pnpm run db:migrate` to run migrations.
- Use camelCase for names when using Kysely in migrations. We have a Kysely plugin that will convert them to snake_case when compiling the query. The only times you write with snake_case is when writing raw SQL.
- Only create irreversible migrations as a last resort, when all other possibilities where considered.
- Unless the migration is irreversible, run `pnpm run db:migrate` to test the migration and then `pnpm run db:rollback` to test the rollback before running `pnpm run db:migrate` again for final application.

## Fixing Bugs

When addressing a bug, follow a test-driven development approach:

1. **Red** – Write a test that reproduces the issue and fails.
2. **Green** – Implement the minimal fix so the new test passes.
3. **Refactor** – Clean up the solution while keeping all tests green.

## Framework concepts

**Route Structure:**
- Uses React Router with config-based routing at `apps/web/app/routes.ts` (REMEMBER to update `routes.ts` when changing routes)
- Loaders use `load()` helper with context validation
- Actions use `act()` helper for form processing

**Composable Functions:**
- Business logic uses `composable-functions` library
- Schema validation with `applySchema(inputSchema, contextSchema)`
- Context passing ensures authorization at every layer

**Framework folder:**
- Reusable abstractions live in `apps/web/app/framework/`. Load the `framework-folder` and `business-folder` skills for deciding where to save a new abstraction.
- Server-only files end in `.server.ts` / `.server.tsx`. Universal files do not.

## Quality bar

We care a lot about beautifully simple UI/UX. Always ensure our UX/UI is outstanding and follows our design system. We care even more about code quality. Please ensure our code is a work of art, always as simple as it can be, with the right domain language and prose. NEVER compromise on this quality bar to save time or tokens.

## Deploying

Production deploys happen only by publishing a GitHub release tagged `v<N>`: the `Deploy to production` workflow force-pushes the released commit to the remote `production` branch, and the DigitalOcean app deploys it from there. Never push to `production` directly and never trigger deployments through doctl. To roll back, publish a release pointing at an older commit. Details in README § Deployment.

## Worktrees

Independent tasks run in isolated git worktrees, each with its own databases, ports, env files, and dev server. Use `pnpm run worktree:setup <lane>` / `pnpm run worktree:teardown <lane>`, and load the `worktrees` skill for the lifecycle, naming conventions, and guardrails.

ALWAYS work in an isolated worktree unless told otherwise. The one exception is a documentation-only change (defined in the Definition of Done): it uses no database, ports, or dev server, so it runs on a branch off the main checkout — or, when the main checkout is dirty or holds another lane's branch, in a plain `git worktree add` with no provisioning. `worktree:setup` is never needed for one.

## Testing with agent-browser

Load the `agent-browser` skill to test your work end to end with a browser. ALWAYS test your work end to end with `agent-browser`.

## Orchestration

These instructions are for the top-level session — the orchestrator. If you are a subagent (you were spawned with a specific task and your final report goes back to a coordinator), they are not addressed to you: execute your task directly — read, build, and test yourself — and never spawn subagents, launch workflows, open PRs, or merge unless your task instructions explicitly say to.

Act as the orchestrator on every task, not just during `/goal` loops. Delegate execution to subagents and dynamic workflows and keep your own context lean: subagents do the heavy reading, building, and testing, and report conclusions back — don't read what a subagent can read for you.

Load the `subagents` skill before spawning subagents or dynamic workflows — it covers which model tier and reasoning effort to use for each kind of work and how to split tasks. Load the `orchestration` skill alongside it — it covers charters, verifying subagent claims, recovery after interruptions, and shipping lane PRs. Size every subagent task so its context lands at roughly one-third of the 1M-token window by completion, since these models start degrading past ~25–33% fill.

Break the work down however you think is best, as long as you respect dependencies: work that depends on other work only starts when the dependency has fully landed. Independent work runs in parallel, each piece in its own worktree. Use well-designed dynamic workflows whenever the work allows for parallelism.

Our baseline is all checks passing: tsc, lint, tests, etc. Whenever that baseline gets lost for any reason, stop everything and restore the baseline with the highest quality level.

Long tasks get compacted several times, so keep a scratchpad ledger file with all the durable lessons and state you'll need after compaction. NEVER trust your compacted context. Always reground yourself on the ledger and the real sources of truth: our codebase, PRs, prototypes, etc.

When you need the user's input, ask in regular conversation, and keep working on whatever doesn't depend on the answer. Ask exactly one question per message and wait for the answer — never bundle multiple questions, even related ones.

## Working with /goal goals

A `/goal` goal follows the same orchestration approach as everything else. The one difference: a goal allows multiple PRs to be merged during development, against the goal's base branch — `main` unless the goal says otherwise. As you personally review each PR, feel free to merge it to the base branch when you consider it ready. The only rule is not to merge broken work.

During `/goal` loops, ask for the user's input through questionnaire questions instead of regular conversation — the questionnaire is the only tool that makes the goal-checker agent stop. If you ask through regular text and the user is not around at that point in time, the goal-checker agent will prompt you to continue working until you reach the goal and your message will be lost.

When the goal is met, load the `self-improvement` skill and run it once over the whole effort's record before marking the goal complete.

## Definition of Done

Quick iterations: when the user explicitly invokes `/quick`, the reduced Definition of Done in the `quick` skill replaces this list for that task. Quick mode is never self-selected and never suggested — only the user's `/quick` turns it on, and its rules live in the skill.

Documentation-only changes: when every file in the diff is markdown — docs, skills, `CLAUDE.md`, README — or `.github/workflows/ci.yml`, the checklist collapses to: a branch off the main checkout instead of a provisioned worktree (or, when the main checkout is busy, an unprovisioned `git worktree add` — see § Worktrees), `pnpm run lint` as the only local gate, no leftover comments, a single code-review pass over the committed diff — fix what it surfaces — and a PR with CI green. Every other criterion below — agent-browser, Playwright coverage, mobile, `architecture.md`, the user manual, MCP parity, dev seed — exists for files the app loads, so none of them can apply; skip them outright, no written justification needed. `ci.yml` qualifies because it runs on the PR itself: a broken edit fails visibly before merge. Workflows triggered only by release or dispatch (`deploy-production.yml`, the mobile OTA workflows) get no such pass — nothing validates them before merge, and a broken edit surfaces at deploy time — so an edit to one is treated as code, with extra review care. The self-improvement criterion still stands, though for a diff this small "nothing to codify" is the usual outcome — and a self-improvement PR never triggers a self-improvement pass of its own. The moment the diff also touches code, scripts, or any other configuration, the full list applies.

- A task is not done unless `pnpm run lint`, `pnpm run tsc`, and `pnpm run test:unit` are all passing. (A documentation-only diff follows the reduced path above: `tsc` and the unit suites cannot be affected by files the app never imports.)
- The full E2E suite runs on the PR's CI, never locally — this applies to every agent, subagents included, and no charter may require it. Open the PR once the fast gates above pass, treat the CI E2E job as the acceptance gate, and fix any red on the branch. Locally, run at most the specs a change directly touches (`pnpm run build && pnpm run test:e2e -- tests/<file>.spec.ts` — the filter must be a path or `--grep`; a bare name is silently ignored and the full suite runs), and reserve a full local run for debugging a CI failure that resists spec-level reproduction.
- A task is not done if it has leftover comments. ALWAYS remove leftover comments before finishing. Our work should NOT add comments unless it's an incredibly complex operation.
- A task is not done if it has not passed a code review of the work's actual diff, based on your judgement. Commit the work on its branch first, then review that branch's real diff — either a review agent pointed explicitly at the working directory (`git -C <worktree> diff <base>...HEAD`) or `/code-review` run from inside that directory. Run from anywhere else, `/code-review` diffs the session's own working directory and silently reviews the wrong change. Do not take the review's suggestions at face value. Loop until YOU are satisfied with the quality.
- A task is not done if you haven't tested it end to end with `agent-browser`, took screenshots, and validated its design as well as its functionality. When the change touches a family of parallel implementations — the questionnaires, the in-person exams — exercise every member, because siblings that share a rendering path can diverge in what they store and a representative proves only itself.
- A task is not done if it changed a user-facing flow without a Playwright spec covering the changed behavior — a new spec, or an existing one updated to assert it — and without every route the flow touches reaching the coverage gate as covered. The gate (apps/web/tests/coverage/gate.ts) fails a full run that leaves a route unreached; parking a route in `pending.ts` is an explicit debt its feature settles before it is done, and an exclusion needs a written rationale citing the unit test that owns the behavior. Load the `testing` skill for the spec conventions.
- A task is not done if a change to the Expo shell was verified only on the web. Mobile verification — opening a simulator at all — is required only when the diff touches `apps/mobile/` or `packages/bridge/`; no other change opens one, and the `mobile-verification` skill holds the audit command and its one carve-out. Everything else is plain web content inside a WebView and verifies web-only with agent-browser, including a narrow-viewport (~375px) pass; the periodic full-parity sweep defined in the `mobile-verification` skill catches the drift that allows. When a change does trip the trigger, drive only the changed behavior on iOS with targeted Maestro flows from `apps/mobile/e2e/` — never the full suite, which belongs to the parity sweep — reusing the installed dev-client; only a change to the native layer itself warrants a build. Android runs only for explicitly Android-scoped work or the parity sweep. Shell-hostile regressions — text selection, zoom, overscroll, safe-area breakage, checkout leakage into the shell, broken deep links — are failures.
- A task is not done if it made an architecturally material change (a new or changed product surface, end-to-end flow, domain, background job, LLM provider, permission catalog, or cross-cutting pattern) without updating `architecture.md`. Load the `architecture-md` skill to decide whether the change is material and how to update the doc.
- A task is not done if a user-facing change left the in-app user manual ("Manual do usuário") describing the old behavior. Load the `user-manual` skill to keep the manual current whenever you add or change a product surface, permission, menu item, or user-facing flow.
- A task is not done if it added or changed an app capability without extending the MCP server to match. The parity test (apps/web/app/mcp/parity.test.ts) enforces this — never satisfy it by adding to pending-coverage.ts or by exempting a genuine user capability. Load the mcp-server skill and wrap the capability as a tool.
- A task is not done if it added or changed a user-facing product surface without shipping its dev-seed section and a matching entry in the seed coverage manifest (`apps/web/app/db/dev-seed/coverage-manifest.ts`). Every surface either seeds its demo-critical state (asserted by `dev-seed/coverage.test.ts` against a throwaway database running the real pipeline) or is declared unseedable with a written reason — never silently omitted. The manifest test fails when a listed surface's demo state is missing; unlike the MCP parity test it cannot detect an unlisted surface, so adding the entry is this criterion's review-time requirement. Keep the dev seed single-shot and fail-loud, guarded by the empty-database pre-flight (`dev-seed/preflight.ts`): never reseed a populated database and never add a reset script — to reseed, drop and recreate the database.
- After every other criterion passes, load the `self-improvement` skill: derive the task's lessons and open self-improvement PRs for the ones worth codifying. Never merge these PRs — the user reviews and merges them personally. Finding nothing to codify is a valid outcome. Tasks inside a `/goal` goal skip this step — the goal runs a single self-improvement pass when it is met.

## Additional warnings

- DO NOT change dependency arrays just to make the linter happy or to follow React "best practices". You'll create infinite render loops. Only add things to dependency arrays when they really need to be there.
