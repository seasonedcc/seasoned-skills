---
name: composable-functions
description: Work with composable-functions library for type-safe business logic. Use when working with applySchema, withContext, pipe, sequence, business functions, context validation, input validation, or when user mentions composable functions, schemas, or error handling patterns.
---

# Composable Functions

Work with the composable-functions library for building type-safe, composable business logic.

## Overview

Composable functions provide a functional programming approach to building robust business logic with:

- **Type safety**: Full TypeScript support with type inference
- **Error handling**: Structured error types (InputError, ContextError)
- **Composition**: Combinators like pipe, sequence, all, collect
- **Schema validation**: Runtime validation with Zod or other @standard-schema libraries
- **Context passing**: Automatic context forwarding for authorization

## Core Types

### Composable

A function that returns `Promise<Result<T>>`:

```typescript
import { composable } from 'composable-functions'

const add = composable((a: number, b: number) => a + b)
//    ^? Composable<(a: number, b: number) => number>
```

### Result

Union type representing success or failure:

```typescript
type Result<T> = Success<T> | Failure

// Success
{
  success: true,
  data: T,
  errors: []
}

// Failure
{
  success: false,
  errors: Error[]
}
```

Always check `success` before accessing `data`:

```typescript
const result = await fn()
if (!result.success) {
  // Handle errors
  return
}
// result.data is now type-safe
```

## Error Types

### InputError

Validation errors for user input:

```typescript
import { InputError } from 'composable-functions'

throw new InputError('Required field', ['email'])
```

### ContextError

Authorization or environment errors:

```typescript
import { ContextError } from 'composable-functions'

throw new ContextError('Unauthorized', ['currentUser', 'role'])
```

### ErrorList

Group multiple errors:

```typescript
import { ErrorList, InputError, ContextError } from 'composable-functions'

throw new ErrorList([
  new InputError('Required', ['name']),
  new ContextError('Forbidden', ['user'])
])
```

## Schema Validation with applySchema

Use `applySchema` to validate inputs and context at runtime:

```typescript
import { applySchema } from 'composable-functions'
import { z } from 'zod'

const fn = applySchema(
  z.object({ id: z.string() }),           // Input schema
  z.object({ currentUser: userSchema })    // Context schema
)(({ id }, context) => {
  // Both input and context are validated
  return db.find(id)
})
```

In this repo, use context schemas from `auth.server`:

```typescript
import { applySchema } from 'composable-functions'
import { userContextSchema } from '~/business/auth.server'
import { z } from 'zod'

const updateUser = applySchema(
  z.object({ userId: z.string(), name: z.string() }),
  userContextSchema
)(async ({ userId, name }, context) => {
  // context.currentUser is guaranteed to exist
  return db.users.update(userId, { name })
})
```

### Array fields from forms and fetchers

Form parsing builds an array from a field only when the request body repeats the key. Submit array fields as repeated `field[]` entries on a `URLSearchParams`:

```typescript
const body = new URLSearchParams()
body.append('hand', hand)
for (const attempt of attempts) body.append('tries[]', attempt)
fetcher.submit(body, { action, method: 'post' })
```

Two traps make the obvious alternatives wrong:

- `fetcher.submit({ tries: ['30', '31'] })` serializes through `new URLSearchParams(object)`, which comma-joins the array into one `tries=30,31` value — the schema receives a single string.
- A repeated bare key (`tries=30&tries=31`) only parses as an array when there are two or more entries; a single entry arrives as a scalar and fails an array schema. The `[]` suffix yields an array even for one entry (existing precedent: `permissions[]`).

Validation errors for array fields come back nested by position, not flat: `{ tries: { "0": ["Enter a number"], "1": ["…"] } }`. Positions index the submitted array, so when the client compacts gaps before submitting, map each position back through the submitted slots to anchor the error on the right input.

## Composition Combinators

### pipe

Sequential composition (left to right):

```typescript
import { pipe } from 'composable-functions'

const add = (a: number, b: number) => a + b
const double = (n: number) => n * 2
const addAndDouble = pipe(add, double)

const result = await addAndDouble(2, 3)
// result.data = 10
```

### sequence

Like pipe, but returns all intermediate results:

```typescript
import { sequence } from 'composable-functions'

const a = (n: number) => String(n)
const b = (s: string) => s === '1'
const fn = sequence(a, b)

const result = await fn(1)
// result.data = ['1', true]
```

### all

Run functions in parallel with same inputs:

```typescript
import { all } from 'composable-functions'

const add = (a: number, b: number) => a + b
const mul = (a: number, b: number) => a * b
const fn = all(add, mul)

const result = await fn(2, 3)
// result.data = [5, 6]
```

### collect

Like all, but with named results:

```typescript
import { collect } from 'composable-functions'

const sum = (a: number, b: number) => a + b
const product = (a: number, b: number) => a * b
const fn = collect({ sum, product })

const result = await fn(2, 3)
// result.data = { sum: 5, product: 6 }
```

### branch

Conditional execution:

```typescript
import { branch } from 'composable-functions'

const getIdOrEmail = (data: { id?: number, email?: string }) =>
  data.id ?? data.email

const findById = (id: number) => db.users.find({ id })
const findByEmail = (email: string) => db.users.find({ email })

const findUser = branch(
  getIdOrEmail,
  (idOrEmail) => typeof idOrEmail === 'number' ? findById : findByEmail
)
```

### map

Transform successful output:

```typescript
import { map } from 'composable-functions'

const add = (a: number, b: number) => a + b
const addAndFormat = map(add, (sum) => `Result: ${sum}`)

const result = await addAndFormat(2, 3)
// result.data = 'Result: 5'
```

## Working with Context

The `withContext` namespace provides combinators that automatically pass context through compositions:

### withContext.pipe

```typescript
import { withContext } from 'composable-functions'

const a = (str: string, ctx: { user: User }) => str === '1'
const b = (bool: boolean, ctx: { user: User }) => bool && ctx.user.admin

const fn = withContext.pipe(a, b)

const result = await fn('1', { user: { admin: true } })
// result.data = true
```

### withContext.sequence

```typescript
import { withContext } from 'composable-functions'

const a = (n: number, ctx: { user: User }) => String(n)
const b = (s: string, ctx: { user: User }) => s === '1'

const fn = withContext.sequence(a, b)

const result = await fn(1, { user: { admin: true } })
// result.data = ['1', true]
```

### withContext.branch

```typescript
import { withContext } from 'composable-functions'

const checkAdmin = (data: any, ctx: { user: User }) => ctx.user.admin
const adminAction = (data: any, ctx: { user: User }) => 'admin'
const userAction = (data: any, ctx: { user: User }) => 'user'

const fn = withContext.branch(
  checkAdmin,
  (isAdmin) => isAdmin ? adminAction : userAction
)
```

## Application Patterns

The three-layer architecture (components → loaders/actions → business functions) and the context-schema hierarchy live in the authorization skill — load it for those patterns.

### Route schemas vs business schemas

The convention across the codebase: `<name>FormSchema` — only the fields the form actually renders — for the route's `act()`/`SchemaForm`, and `<name>Schema` — form fields plus ids — for the business function's `applySchema()`. The action supplies the ids from `params`.

`act()` builds the mutation input from search params, route params, and the parsed form values under one pinned contract: a submitted form field wins for exactly the fields the form actually submitted, and route parameters win for everything it did not — so a schema's coerced default (an unchecked checkbox's `false`, an absent text field's `''`) can never silently overwrite a real parameter. The contract is pinned by a test that travels with `act()` — read it before relying on subtler interactions, and extend it when changing how `act()` resolves input.

### remix-forms sharp edges

- A `z.preprocess` wrapper hides `.optional()` from remix-forms' shape introspection, wrongly marking the field required — use plain `.optional()`.
- The checkbox schema coerces only the strings `'true'`/`'on'`; a JS boolean `true` in a test payload silently becomes false.
- Every guard/validation `InputError` needs an explicit field path — a pathless error (or one under a key the form doesn't render) displays nothing through `act()`, making the failure invisible to the user.

## Error Handling

### Check error types

```typescript
import { isInputError, isContextError } from 'composable-functions'

const result = await fn(input)
if (!result.success) {
  const inputErrors = result.errors.filter(isInputError)
  const contextErrors = result.errors.filter(isContextError)
}
```

### Transform errors

```typescript
import { mapErrors } from 'composable-functions'

const withCustomErrors = mapErrors(fn, (errors) =>
  errors.map(e => e.message.includes('Not found')
    ? new NotFoundError()
    : e
  )
)
```

### Catch failures

```typescript
import { catchFailure } from 'composable-functions'

const optional = catchFailure(fn, (errors, ...args) => {
  console.log('Failed:', errors)
  return null
})
```

## Utilities

### fromSuccess

Unwrap successful result or throw errors:

```typescript
import { fromSuccess } from 'composable-functions'

const fn = composable(async (id: string) => {
  const user = await fromSuccess(getUser)(id)
  return { user, extra: 'data' }
})
```

### success / failure

Create results manually:

```typescript
import { success, failure } from 'composable-functions'

return success({ data: 'value' })
return failure([new Error('Something wrong')])
```

### serialize / serializeError

Make results JSON-safe:

```typescript
import { serialize } from 'composable-functions'

const serialized = JSON.stringify(serialize(result))
```

## Form Input Helpers

Extract structured data from web requests:

```typescript
import {
  inputFromForm,      // Extract from Request (FormData)
  inputFromFormData,  // Extract from FormData object
  inputFromUrl,       // Extract from Request (query params)
  inputFromSearch,    // Extract from URLSearchParams
} from 'composable-functions'

// In a loader/action
const formData = await inputFromForm(request)
const queryParams = inputFromUrl(request)
```

## Common Patterns

### Validate and transform

```typescript
const fn = pipe(
  applySchema(inputSchema, contextSchema)(validateAndParse),
  map(transformData),
  applySchema(outputSchema)(finalValidation)
)
```

### Parallel data fetching

```typescript
const fetchAll = collect({
  user: getUser,
  posts: getPosts,
  comments: getComments,
})

const result = await fetchAll({ userId: '123' })
// result.data = { user, posts, comments }
```

### Conditional authorization

```typescript
const fn = applySchema(inputSchema, userContextSchema)(
  async (input, context) => {
    if (!isAdmin(context.currentUser)) {
      throw new ContextError('Admin only', ['currentUser', 'role'])
    }
    return performAdminAction(input)
  }
)
```

## Complete Documentation

For the full API reference, migration guides, and all code examples, see [references/complete-docs.md](references/complete-docs.md).

## Best Practices

1. **Always validate context**: Use context schemas with `applySchema`
2. **Check success before data access**: TypeScript enforces this
3. **Use specific error types**: InputError for user input, ContextError for authorization
4. **Prefer composition over nesting**: Use combinators instead of manual composition
5. **Keep functions focused**: One composable = one responsibility
6. **Use withContext for context-heavy flows**: Simplifies passing context through pipelines
7. **Test with fromSuccess**: Unwrap results in tests for simpler assertions

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/composable-functions.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
