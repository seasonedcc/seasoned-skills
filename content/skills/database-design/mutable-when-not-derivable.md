## Mutable columns are fine — when not derivable

Mutable columns that get updated in place are acceptable, as long as their value can't be inferred from child records. A column that is always updated in tandem with inserting an event record is derivable and should be removed.

## No cascade deletes

Never use `ON DELETE CASCADE` on foreign keys. Prefer explicit deletes in application code or migrations. Cascade deletes are dangerous because a developer unfamiliar with the schema can accidentally delete large amounts of data by removing a single parent row.

Instead of:
```typescript
.addColumn('resultId', 'uuid', (col) =>
  col.notNull().references('results.id').onDelete('cascade'),
)
```

Do:
```typescript
.addColumn('resultId', 'uuid', (col) =>
  col.notNull().references('results.id'),
)
```

When child records need to be deleted alongside a parent, delete them explicitly in a transaction:

```typescript
await db()
  .transaction()
  .execute(async (trx) => {
    await trx.deleteFrom('childRecords').where('parentId', '=', parentId).execute()
    await trx.deleteFrom('parents').where('id', '=', parentId).execute()
  })
```
