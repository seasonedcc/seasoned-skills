---
name: testing
description: Write and run tests for product-monolith using pytest (unit tests) and Playwright via pytest-playwright (E2E tests). Use when writing tests, fixing tests, running tests, implementing TDD, seeding E2E data, or when the user mentions testing, test-driven development, unit tests, E2E tests, Playwright, or mutation proofs.
---

# Testing (product-monolith)

The full testing playbook lives in the repo: `product-monolith/docs/process/testing.md`. Read it before any testing work — execution commands, TDD and mutation proofs, gate reconciliation, unit-testing doctrine, the E2E stack and its core principles, and the settled decisions all live there. The authoritative law for test shape is `product-monolith/docs/process/engineering-conventions.md`, which outranks the playbook wherever they overlap; `product-monolith/AGENTS.md` governs commit conventions and carries the Definition of Done.

Workspace notes the playbook doesn't carry:

- Testing lessons are codified in the playbook via a product-monolith PR, never accreted here — this skill stays a pointer.
- `make e2e` derives its `_e2e` database pair from the checkout's own `DATABASE_URL`/`DATABASE_MESSAGE_URL`, so worktree lanes get isolated E2E databases automatically. The broker is the lane's own Redis index but the queue names are shared with the lane's dev stack — stop the lane's `make celery` (and `make dev`) before `make e2e`.
