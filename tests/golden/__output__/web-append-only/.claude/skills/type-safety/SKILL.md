---
name: type-safety
description: Write minimal, correct TypeScript type annotations. Use when adding types, declaring variables, writing function signatures, creating type aliases, or reviewing code for unnecessary type declarations.
---

# Type Safety

Lean on TypeScript's inference. Only add type annotations when removing them would lose type safety or cause a compile error. Before adding any annotation, ask: "Would TypeScript infer the correct type without this?"

## Return Types

Do not add return types to functions. TypeScript infers them from the function body.

```typescript
// correct
async function fetchRecords() {
  const records: DedupRecord[] = []
  // ...
  return records
}

// wrong — redundant return type
async function fetchRecords(): Promise<DedupRecord[]> {
  const records: DedupRecord[] = []
  // ...
  return records
}
```

### Exceptions where return types are required

- **Interface implementations** — when a method must satisfy a library interface (e.g., Kysely's `MigrationProvider`)
- **Non-async functions returning promises** — when the function returns a promise without `async`, TypeScript may infer a more complex type than intended

## Variable Annotations

Do not annotate variables when the type is obvious from the right-hand side.

```typescript
// correct — type inferred from string literal
const name = 'hello'

// wrong — redundant
const name: string = 'hello'
```

### Empty collections need annotations

TypeScript cannot infer the element type from an empty literal. Always annotate empty arrays and objects that will be populated later.

```typescript
// correct — TypeScript can't know this will hold strings
const lines: string[] = []
const records: DedupRecord[] = []

// correct — TypeScript can't infer target shape from {}
const searchValues = searchKeys.reduce<Record<string, string[]>>(
  (values, key) => ({ ...values, [key]: search.getAll(key) }),
  {},
)
```

## Record Types on Map Constants

When a constant object is indexed with a dynamic string key, it needs `Record<string, string>`. Without it, TypeScript infers a specific literal object type that doesn't accept arbitrary string indexing.

```typescript
// correct — indexed with dynamic key: MAP[someVariable]
const ROMAN_TO_ARABIC: Record<string, string> = {
  II: '2',
  III: '3',
  IV: '4',
}
const number = ROMAN_TO_ARABIC[rawNumber] // works

// If only accessed via Object.entries or Object.keys, the annotation
// is optional but keep it for consistency with other maps in the file
```

## Function Parameter Defaults

A default value of `{}` or `[]` does not tell TypeScript the intended type. Annotate the parameter.

```typescript
// correct — {} alone would give type {}
function createXmlElement(
  tagName: string,
  attributes: Record<string, string> = {},
) { ... }
```

## Zod Type Aliases

Use `z.infer<typeof schema>` to derive types from Zod schemas. Do not manually write a type that mirrors a schema.

```typescript
// correct — single source of truth
const profileSchema = z.object({
  displayName: z.string(),
  email: z.string(),
})
type Profile = z.infer<typeof profileSchema>
```

Only keep a `z.infer` type alias if it is used in more than one place. If it only appears as a function return type annotation, remove both the alias and the annotation — TypeScript infers the return type from the Zod-parsed result.

## Reuse Existing Types

Before writing an inline type, check if the same shape already exists. Import it instead of duplicating.

```typescript
// correct — reuses existing ListInput from the framework
import type { ListInput } from '~/framework/schemas'
function fetchItems(query: Query, pagination: ListInput) { ... }

// wrong — duplicates ListInput
function fetchItems(query: Query, pagination: { page: number; perPage: number }) { ... }
```

Key shared types in this codebase:

- `CompanyContext` — the authenticated company scope every loader receives.
- `DB` — the generated database schema types.

## Route-Derived Types

In React Router route files, derive component types from `Route.ComponentProps` rather than importing from server files. This keeps types aligned with the actual loader data flow.

```typescript
// correct — derived from route types
type Job = Route.ComponentProps['loaderData']['jobs'][number]
type JobStatus = Job['status']

// wrong — importing server type into a component file
import type { JobStatus } from '~/business/worker-jobs.server'
```

## Generic Type Arguments

Do not pass explicit generic arguments when TypeScript can infer them from the function arguments.

```typescript
// correct — generics inferred from arguments
const result = await fetchList(baseQuery, itemsQuery, { page, perPage })

// wrong — unnecessarily explicit
const result = await fetchList<DB, 'users', TotalOut, ItemsOut>(baseQuery, itemsQuery, { page, perPage })
```

## Type Assertions

Use `as` assertions only when TypeScript genuinely cannot know the type:
- `response.json()` from untyped HTTP APIs — cast to the expected shape
- `$castTo<T>()` in Kysely for complex queries the ORM can't infer
- `as const` for literal tuples and objects that should not be widened
- `{} as LibraryType` in tests for mocking

Do not use `as` to silence type errors — fix the underlying type instead.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/type-safety.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
