## INSERT is the only write

The application schema is 100% append-only (load the database-design skill for the full doctrine). Application code never calls `updateTable`, `deleteFrom`, or `truncate` on application tables, and never uses `.onConflict((oc) => oc.doUpdateSet(...))` — an upsert's update arm is an UPDATE. State changes are new event rows; current state is derived at query time (`distinctOn` latest-wins, `EXISTS` checks — see the database-design skill for the canonical derivation patterns).

`.onConflict((oc) => oc.doNothing())` is fine: it makes inserts idempotent without mutating anything.

## Append instead of check-then-branch

The mutable-schema instinct is "check whether a row exists, then insert or update". In an append-only schema there is nothing to branch on: every action appends its event row, and the latest event wins at read time.

Instead of:
```typescript
const existing = await db().selectFrom('invitations').where('email', '=', email).executeTakeFirst()
if (existing) {
  // mutate the existing row's role
} else {
  // insert a new row
}
```

Do:
```typescript
await db()
  .insertInto('invitations')
  .values({ email, role })
  .executeTakeFirstOrThrow()
```

The invitation's current role is derived from the latest invitation event for that email. When an insert must be idempotent (webhooks, retried jobs), add a unique constraint on the natural key and `.onConflict((oc) => oc.doNothing())`.
