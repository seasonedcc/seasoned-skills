## Upserts and in-place writes

In-place updates and explicit transactional deletes are legitimate where the value is not derivable from event records (load the database-design skill for the full write doctrine). Prefer upserts and single composed statements over check-then-branch roundtrips.

## Use `.onConflict()` instead of check-then-insert

Instead of:
```typescript
const existing = await db().selectFrom('invitations').where('email', '=', email).executeTakeFirst()
if (existing) {
  await db().updateTable('invitations').set({ role }).where('id', '=', existing.id).execute()
} else {
  await db().insertInto('invitations').values({ email, role }).execute()
}
```

Do:
```typescript
await db()
  .insertInto('invitations')
  .values({ email, role })
  .onConflict((oc) => oc.column('email').doUpdateSet({ role }))
  .executeTakeFirstOrThrow()
```
