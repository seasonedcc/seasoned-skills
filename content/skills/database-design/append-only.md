## The doctrine: 100% append-only, event-sourced, zero exceptions

The application schema is insert-only. `INSERT` is the only write the application ever performs. No `UPDATE`, no `DELETE`, no `TRUNCATE`, no `ON CONFLICT ... DO UPDATE`. This applies to every application table with zero exceptions — including users, sessions, and anything else that feels "infrastructural". If a design seems to require mutating a row, the design is wrong: model the change as a new event row instead.

What this buys us:

- A complete audit trail with no extra machinery — the schema *is* the audit trail
- Time travel: any past state can be reconstructed by filtering events by `createdAt`
- No lost-update bugs, no race conditions between readers and writers of the same row
- No sync risk between stored state and the events that produced it

The only tables outside the rule are schemas owned by third parties: the job queue's own schema and Kysely's migration bookkeeping table mutate themselves internally. We never design tables there and never write to them directly.

## No mutable columns — period

A column either lives on an identity table because it is immutable by design, or it lives in an event table. There is no third kind. When in doubt whether an attribute is truly immutable for the row's entire life, it is not — put it in an event table.

## Deletion is an event

Never `DELETE`. Removal is a fact that happened, so it is recorded like any other fact:

- User "deletes" a draft → an `order_discards` event; queries exclude discarded orders
- User detaches an association → the association is itself event-shaped: `order_item_additions` / `order_item_removals`
- Data was entered in error → append a correction event; the erroneous event stays in history

Because rows are never deleted, `ON DELETE CASCADE` has nothing to attach to — foreign keys are plain `references(...)` with no delete behavior.

## Migrations never rewrite history

Migrations evolve the schema, and they are bound by the doctrine's spirit: a backfill populates a new structure with `INSERT`s derived from existing rows; a migration never rewrites or erases recorded events. When an existing event table needs a new `NOT NULL` column, introduce a new event table for the extended concern instead of reshaping history.
