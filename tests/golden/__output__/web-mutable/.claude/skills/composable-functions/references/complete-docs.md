# Composable Functions v5.0.0 - Complete Documentation

This document contains the complete documentation for composable-functions version 5.0.0, retrieved from Context7.

## Table of Contents

- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Composition Combinators](#composition-combinators)
- [Context Handling](#context-handling)
- [Schema Validation](#schema-validation)
- [Error Handling](#error-handling)
- [Form Utilities](#form-utilities)
- [Migration from Domain Functions](#migration-from-domain-functions)
- [Code Examples](#code-examples)

## Installation

Install the composable-functions library using npm:

```bash
npm i composable-functions
```

For Deno:

```typescript
import { composable } from "https://deno.land/x/composable_functions/mod.ts";
```

## Core Concepts

### The Composable Type

A `Composable` is a function that returns a `Promise<Result<T>>`. It automatically handles errors and provides a consistent interface for composition.

```typescript
import { composable } from 'composable-functions'

const add = composable((a: number, b: number) => a + b)
//    ^? Composable<(a: number, b: number) => number>
```

### The Result Type

The `Result<T>` type is a union of `Success<T>` and `Failure`:

```typescript
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

Example usage:

```typescript
const result = await add(1, 2)
console.log(
  result.success ? result.data : `Can't process`
)
```

### Error Handling in Composables

Composables automatically catch thrown errors and return them as failures:

```typescript
const fn = composable((a: number) => {
  throw new Error('Something went wrong')
  return a * 2
})
const result = await fn(2)
console.log(result.errors[0].message)
```

### Type Safety

TypeScript enforces checking the `success` property before accessing `data`:

```typescript
const result = await getUser('123')
if (!result.success) return notFound()

return result.data
//            ^? User (type-safe)
```

Attempting to access `data` without checking results in a type error:

```typescript
const result = await getUser('123')
// @ts-expect-error: Property 'data' does not exist on type 'Result<User>'
return result.data
```

## API Reference

### composable

The fundamental function for creating composable functions. Takes a standard function and returns a composable version.

```typescript
const add = composable((a: number, b: number) => a + b)
//    ^? Composable<(a: number, b: number) => number>
const toString = composable((a: unknown) => `${a}`)
//    ^? Composable<(a: unknown) => string>
const fn = pipe(add, toString)
//    ^? Composable<(a: number, b: number) => string>
```

**Automatic error catching:**

```typescript
const fn = composable((a: number) => {
  throw new Error('Something went wrong')
  return a * 2
})
const result = await fn(2)
console.log(result.errors[0].message)
```

### applySchema

Transforms a function into a `ComposableWithSchema`, enforcing runtime type assertion for unknown inputs and contexts. Particularly useful for validating external data sources like API requests.

```typescript
const fn = (
  { greeting }: { greeting: string },
  { user }: { user: { name: string } },
) => ({
   message: `${greeting} ${user.name}`
})

const safeFunction = applySchema(
  z.object({ greeting: z.string() }),
  z.object({
    user: z.object({ name: z.string() })
  }),
)(fn)

type Test = typeof safeFunction
//   ^? ComposableWithSchema<{ message: string }>
```

**Input validation errors:**

```typescript
const fn = applySchema(
  z.object({ id: z.number() })
)((input) => input)

const result = await fn({ id: '1' })
/* {
  success: false,
  errors: [new InputError('Expected number, received string', ['id'])],
} */
```

**Context validation errors:**

```typescript
const fn = applySchema(
  z.object({ id: z.number() }),
  z.object({
    user: z.object({ id: z.string() }),
  })
)(() => {})

const result = await fn({ id: '1' }, { user: { id: 1 } })
/* {
  success: false,
  errors: [
    new ContextError(
      'Expected string, received number',
      ['user', 'id'],
    ),
  ],
} */
```

### success

Creates a `Success` result object explicitly:

```typescript
const result = success(42)
//    ^? Success<number>
expect(result).toEqual({
  success: true,
  data: 42,
  errors: []
})
```

### failure

Creates a `Failure` result object explicitly:

```typescript
const result = failure([new Error('Something went wrong')])
//    ^? Failure
expect(result).toEqual({
  success: false,
  errors: [new Error('Something went wrong')]
})
```

### fromSuccess

Executes a composable function and unwraps its successful result. If the composable fails, this function will throw the collected errors.

**Using inside other composables:**

```typescript
const getUser = composable((id: string) => db().collection('users').findOne({ id }))

const getProfile = composable(async (id: string) => {
  const user = await fromSuccess(getUser)(id)
  // ... some logic
  return { user, otherData }
})
```

**Testing successful execution:**

```typescript
const fn = map(pipe(add, multiplyBy2), (result) => result * 3)
const number = await fromSuccess(fn)(1, 1)
expect(number).toBe(12)
```

## Composition Combinators

### pipe

Creates a single composable by chaining multiple composables together. The output of each function becomes the input for the next, executing from left to right.

```typescript
const a = (aNumber: number) => String(aNumber)
const b = (aString: string) => aString == '1'
const c = (aBoolean: boolean) => !aBoolean

const d = pipe(a, b, c)

const result = await d(1)
//    ^? Result<boolean>
```

**Type checking:**

Pipe enforces type-checking, resulting in a `FailToCompose` type error when the output of one function doesn't match the input of the next:

```typescript
import { pipe } from 'composable-functions'

const addAndReturnString = pipe(toString, add)
//    ^? Internal.FailToCompose<string, number>
```

**Practical example:**

```typescript
import { composable, pipe } from 'composable-functions'

const faultyAdd = (a: number, b: number) => {
  if (a === 1) throw new Error('a is 1')
  return a + b
}
const show = (a: number) => String(a)
const addAndShow = pipe(faultyAdd, show)

const result = await addAndShow(2, 2)
/*
result = {
  success: true,
  data: "4",
  errors: []
}
*/
const failedResult = await addAndShow(1, 2)
/*
failedResult = {
  success: false,
  errors: [<Error object>]
}
*/
```

### sequence

Chains composables like `pipe` but returns a tuple containing the output of *each* composable in the chain, rather than just the final result.

```typescript
const a = (aNumber: number) => String(aNumber)
const b = (aString: string) => aString == '1'
const c = (aBoolean: boolean) => !aBoolean

const d = sequence(a, b, c)

const result = await d(1)
//    ^? Result<[string, boolean, boolean]>
```

**Transforming to object:**

Combine `sequence` with `map` to transform the tuple into a structured object:

```typescript
const a = (aNumber: number) => String(aNumber)
const b = (aString: string) => aString === '1'

const c = map(sequence(a, b), ([a, b]) => ({ aString: a, aBoolean: b }))

const result = await c(1)
//    ^? Result<{ aString: string, aBoolean: boolean }>
```

### all

Executes multiple functions concurrently and returns a `Composable` that yields a tuple containing the results of all functions once they succeed. All input functions must accept the same arguments.

```typescript
const a = ({ id }: { id: number }) => String(id)
const b = ({ id }: { id: number }) => id + 1
const c = ({ id }: { id: number }) => Boolean(id)

const result = await all(a, b, c)({ id: 1 })
//    ^? Result<[string, number, boolean]>
```

**Error aggregation:**

If any function fails, errors are concatenated:

```typescript
const a = applySchema(z.object({ id: z.number() }))(({ id }) => {
  return String(id)
})
const b = () => {
  throw new Error('Error')
}

const result = await all(a, b)({ id: '1' })
//    ^? Result<[string, never]>
```

**Simple example:**

```typescript
import { all } from 'composable-functions'

const add = (a: number, b: number) => a + b
const mul = (a: number, b: number) => a * b
const addAndMul = all(add, mul)
//    ^? Composable<(a: number, b: number) => [number, number]>
```

### collect

Similar to `all`, but accepts functions in a record with string keys. The structure is preserved in the `data` field of a successful result.

```typescript
const a = () => '1'
const b = () => 2
const c = () => true

const results = await collect({ a, b, c })({})
//    ^? Result<{ a: string, b: number, c: boolean }>
```

**Simple example:**

```typescript
import { collect } from 'composable-functions'

const add = (a: number, b: number) => a + b
const mul = (a: number, b: number) => a * b
const addAndMul = collect({ add, mul })
//    ^? Composable<(a: number, b: number) => { add: number, mul: number }>
```

### branch

Enables conditional execution by taking a composable and a predicate function. The predicate receives the previous result and returns the next composable to run, or `null` to halt execution.

```typescript
const getIdOrEmail = (data: { id?: number, email?: string }) => data.id ?? data.email
const findUserById = (id: number) => db.users.find({ id })
const findUserByEmail = (email: string) => db.users.find({ email })
const findUserByIdOrEmail = branch(
  getIdOrEmail,
  (data) => (typeof data === "number" ? findUserById : findUserByEmail),
)
const result = await findUserByIdOrEmail({ id: 1 })
//    ^? Result<User>
```

**Halting execution:**

```typescript
const a = () => 'a'
const b = () => 'b'
const fn = branch(a, (data) => data === 'a' ? null : b)
//    ^? Composable<() => 'a' | 'b'>
```

**Error in predicate:**

```typescript
const findUserByIdOrEmail = branch(
  getIdOrEmail,
  (data) => {
    throw new Error("Invalid input")
  },
)
//    ^? Composable<({ id?: number, email?: string }) => never>
```

### map

Transforms the successful output of a composable using a simple function.

```typescript
const add = (a: number, b: number) => a + b
const addAndMultiplyBy2 = map(add, sum => sum * 2)
```

**Accessing input parameters:**

The transformation function receives both the result and the original input parameters:

```typescript
const add = (a: number, b: number) => a + b
const aggregateInputAndOutput = map(add, (result, a, b) => ({ result, a, b }))
//    ^? Composable<(a: number, b: number) => { result: number, a: number, b: number }>
```

**Basic example:**

```typescript
import { map } from 'composable-functions'

const addAndReturnString = map(add, result => `${result}`)
//    ^? Composable<(a: number, b: number) => string>
```

**Using in pipe:**

```typescript
const fetchAsText = ({ userId }: { userId: number }) => {
  return fetch(`https://reqres.in/api/users/${String(userId)}`)
    .then((r) => r.json())
}
const fullName = applySchema(
  z.object({ first_name: z.string(), last_name: z.string() }),
)(({ first_name, last_name }) => `${first_name} ${last_name}`)

const fetchFullName = pipe(
  map(fetchAsText, ({ data }) => data),
  fullName,
)

const result = fetchFullName({ userId: 2 })
//    ^? Result<string>
```

### mapParameters

Transforms the input arguments received by the resulting composable into the specific arguments expected by the wrapped composable.

```typescript
const getUser = ({ id }: { id: number }) => db.users.find({ id })

const getCurrentUser = mapParameters(
  getUser,
  (_input: unknown, user: { id: number }) => [{ id: user.id }]
)
//    ^? Composable<(input: unknown, ctx: { id: number }) => User>
```

## Context Handling

### Composable Function Type with Context

Composables can accept both an input and a context object:

```typescript
Composable<(input: I, context: C) => O>
```

### withContext.pipe

Creates a sequential composition of functions, automatically passing the context object along with the result.

```typescript
import { withContext } from 'composable-functions'

const a = (aNumber: number, ctx: { user: User }) => String(aNumber)
const b = (aString: string, ctx: { user: User }) => aString == '1'
const c = (aBoolean: boolean, ctx: { user: User }) => aBoolean && ctx.user.admin

const d = withContext.pipe(a, b, c)

const result = await d(1, { user: { admin: true } })
```

**Practical example:**

```typescript
import { withContext } from 'composable-functions'

const a = (str: string, ctx: { user: User }) => str === '1'
const b = (bool: boolean, ctx: { user: User }) => bool && ctx.user.admin

const pipeline = withContext.pipe(a, b)

const result = await pipeline('1', { user: { admin: true } })
/*
result = {
  success: true,
  data: true,
  errors: []
}
*/
```

### withContext.sequence

Like `sequence` but forwards the context to each function in the chain:

```typescript
import { withContext } from 'composable-functions'

const a = (aNumber: number, ctx: { user: User }) => String(aNumber)
const b = (aString: string, ctx: { user: User }) => aString === '1'
const c = (aBoolean: boolean, ctx: { user: User }) => aBoolean && ctx.user.admin

const d = withContext.sequence(a, b, c)

const result = await d(1, { user: { admin: true } })
```

**Practical example:**

```typescript
import { withContext } from 'composable-functions'

const a = (str: string, ctx: { user: User }) => str === '1'
const b = (bool: boolean, ctx: { user: User }) => bool && ctx.user.admin

const sequence = withContext.sequence(a, b)

const result = await sequence('1', { user: { admin: true } })
/*
result = {
  success: true,
  data: [true, true],
  errors: []
}
*/
```

### withContext.branch

Creates a composable that branches execution based on input, forwarding the context object to the selected branch function.

```typescript
import { withContext } from 'composable-functions'

const getIdOrEmail = (data: { id?: number, email?: string }) => {
  return data.id ?? data.email
}
const findUserById = (id: number, ctx: { user: User }) => {
  if (!ctx.user.admin) {
    throw new Error('Unauthorized')
  }
  return db.users.find({ id })
}
const findUserByEmail = (email: string, ctx: { user: User }) => {
  if (!ctx.user.admin) {
    throw new Error('Unauthorized')
  }
  return db.users.find({ email })
}
const findUserByIdOrEmail = withContext.branch(
  getIdOrEmail,
  (data) => (typeof data === "number" ? findUserById : findUserByEmail),
)
const result = await findUserByIdOrEmail({ id: 1 }, { user: { admin: true } })
```

**Practical example:**

```typescript
import { withContext } from 'composable-functions'

const adminIncrement = (a: number, { user }: { user: { admin: boolean } }) =>
  user.admin ? a + 1 : a
const adminMakeItEven = (sum: number) => sum % 2 != 0 ? adminIncrement : null
const incrementUntilEven = withContext.branch(adminIncrement, adminMakeItEven)

const result = await incrementUntilEven(1, { user: { admin: true } })
/*
result = {
  success: true,
  data: 2,
  errors: []
}
*/
```

### Using withContext in Migrations

When migrating from domain-functions, use `withContext` combinators to ensure context is passed through compositions:

```typescript
import { withContext } from 'composable-functions'

const result = withContext.pipe(fn1, fn2)(input, ctx)
// same for `withContext.sequence` and `withContext.branch`
```

## Schema Validation

### Basic Schema Application

Use `applySchema` with Zod or other @standard-schema compatible libraries:

```typescript
import { composable, applySchema } from 'composable-functions'
import { z } from 'zod'

const fn = ({ greeting }: { greeting: string }, { user }: { user: { name: string } }) => ({
  message: `${greeting} ${user.name}`
})

const safeFunction = applySchema(
  z.object({ greeting: z.string() }),
  z.object({ user: z.object({ name: z.string() }) })
)
const fnWithSchema = safeFunction(fn)

type Test = typeof fnWithSchema
//   ^? ComposableWithSchema<{ message: string }>
```

### Runtime Validation

Schemas are validated at runtime, producing typed errors:

```typescript
import { applySchema } from 'composable-functions'
import { z } from 'zod'
import { type } from 'arktype'

const addAndReturnWithRuntimeValidation = applySchema(
  z.number(),
  type('number'),
)(addAndReturnString)
```

## Error Handling

### Error Types

#### InputError

Represents validation errors for user input:

```typescript
import { InputError } from 'composable-functions'

throw new InputError('Custom input error', ['contact', 'id'])
```

#### ContextError

Represents authorization or environment errors:

```typescript
import { ContextError } from 'composable-functions'

throw new ContextError('Custom context error', ['currentUser', 'role'])
```

#### ErrorList

Groups multiple errors together:

```typescript
const fn = composable(() => {
  throw new ErrorList([
    new InputError('Custom input error', ['contact', 'id']),
    new ContextError('Custom context error', ['currentUser', 'role']),
  ])
})
const result = await fn()
// {
//   success: false,
//   errors: [
//     new InputError('Custom input error', ['contact', 'id']),
//     new ContextError('Custom context error', ['currentUser', 'role']),
//   ],
// }
```

### Custom Error Classes

Create and throw custom error types:

```typescript
import { composable } from 'composable-functions'

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

const getUser = composable((userId: string, users: Array<string>) => {
//    ^? Composable<(userId: string, users: Array<string>) => string>
    const result = users.find(({id}) => id === userId)
    if(result == undefined) throw new NotFoundError(`userId ${userId} was not found`)
    return result
})
```

### Checking Error Types

Use helper functions to identify error types:

```typescript
import { isInputError, isContextError } from 'composable-functions'

isInputError(new InputError('yes')) // true
isInputError(new Error('nope')) // false

isContextError(new ContextError('yes')) // true
isContextError(new Error('nope')) // false
```

### catchFailure

Intercepts and handles errors from a composable:

```typescript
import { composable, catchFailure } from 'composable-functions'

const getUser = (id: string) => fetchUser(id)
//    ^? Composable<(id: string) => User>
const getOptionalUser = catchFailure(getUser, (errors, id) => {
  console.log(`Failed to fetch user with id ${id}`, errors)
  return null
})
//    ^? Composable<(id: string) => User | null>
```

### mapErrors

Transforms the errors array of a failed composable:

```typescript
import { mapErrors } from 'composable-functions'

const getUserWithCustomError = mapErrors(getUser, (errors) =>
  errors.map((e) => e.message.includes('Invalid ID') ? new InvalidUserId() : e)
)
```

**Example:**

```typescript
const increment = (n: number) => {
  if (Number.isNaN(n)) {
    throw new Error('Invalid input')
  }
  return n + 1
}
const summarizeErrors = (errors: Error[]) =>
  [new Error('Number of errors: ' + errors.length)]

const incrementWithErrorSummary = mapErrors(increment, summarizeErrors)

const result = await incrementWithErrorSummary({ invalidInput: '1' })
```

### trace

Wraps a composable to execute side-effects with the result and original arguments:

```typescript
const traceToConsole = trace((result, ...args) => {
  if(!result.success) {
    console.trace("Composable Failure ", result, ...args)
  }
})

// Apply to another composable
traceToConsole(otherFn)
```

**Async example:**

```typescript
const trackErrors = trace(async (result, ...args) => {
  if(!result.success && someOtherConditions(result)) {
    await sendToExternalService({ result, args })
  }
})
```

**Updated signature:**

The trace function now receives both the result and all original arguments:

```typescript
const fn = (a: number, b: number, c: number) => a + b + c
const withTrace = trace((...args) => console.log(...args))(fn)
const result = await withTrace(1, 2, 3)
// This will log: [{ success: true, data: 6, errors: [] }, 1, 2, 3]
```

### Serializing Errors

Use `serialize` and `serializeError` to make errors JSON-safe:

```typescript
import { serialize } from 'composable-functions'

const serializedResult = JSON.stringify(serialize({
  success: false,
  errors: [new InputError('Oops', ['name'])],
}))

// serializedResult is:
`"{ success: false, errors: [{ message: 'Oops', name: 'InputError', path: ['name'] }] }"`
```

**Single error:**

```typescript
const serialized = JSON.stringify(
  serializeError(new InputError('Oops', ['name']))
)

// serialized is:
`"{ message: 'Oops', name: 'InputError', path: ['name'] }"`
```

## Form Utilities

### inputFromForm

Extracts form data from a Request object:

```typescript
import { inputFromForm } from 'composable-functions'

async function handleRequest(request: Request) {
  const values = await inputFromForm(request)
  // values = { email: 'john@doe.com', password: '1234' }
}
```

**Example with HTML form:**

```tsx
// Given the following form:
function Form() {
  return (
    <form method="post">
      <input name="email" value="john@doe.com" />
      <input name="password" value="1234" />
      <button type="submit">
        Submit
      </button>
    </form>
  )
}

async (request: Request) => {
  const values = await inputFromForm(request)
  // values = { email: 'john@doe.com', password: '1234' }
}
```

**Structured data:**

```tsx
// Given the following form:
function Form() {
  return (
    <form method="post">
      <input name="numbers[]" value="1" />
      <input name="numbers[]" value="2" />
      <input name="person[0][email]" value="john@doe.com" />
      <input name="person[0][password]" value="1234" />
      <button type="submit">
        Submit
      </button>
    </form>
  )
}

async (request: Request) => {
  const values = await inputFromForm(request)
  /*
  values = {
    numbers: ['1', '2'],
    person: [{ email: 'john@doe.com', password: '1234' }]
  }
  */
}
```

### inputFromFormData

Extracts values from a FormData object:

```typescript
import { inputFromFormData } from 'composable-functions'

const formData = new FormData()
formData.append('email', 'john@doe.com')
formData.append('tasks[]', 'one')
formData.append('tasks[]', 'two')
const values = inputFromFormData(formData)
// values = { email: 'john@doe.com', tasks: ['one', 'two'] }
```

### inputFromUrl

Extracts query parameters from a Request URL:

```typescript
import { inputFromUrl } from 'composable-functions'

async function handleRequest(request: Request) {
  const values = inputFromUrl(request)
  // values = { page: '2' }
}
```

**Example with form:**

```tsx
// Given the following form:
function Form() {
  return (
    <form method="get">
      <button name="page" value="2">
        Change URL
      </button>
    </form>
  )
}

async (request: Request) => {
  const values = inputFromUrl(request)
  // values = { page: '2' }
}
```

### inputFromSearch

Extracts values from a URLSearchParams object:

```typescript
import { inputFromSearch } from 'composable-functions'

const qs = new URLSearchParams()
qs.append('colors[]', 'red')
qs.append('colors[]', 'green')
qs.append('colors[]', 'blue')
const values = inputFromSearch(qs)
// values = { colors: ['red', 'green', 'blue'] }
```

## Migration from Domain Functions

### Result Structure Changes

**Old (domain-functions):**

```typescript
{
  success: false,
  errors: [{ message: 'Something went wrong' }],
  inputErrors: [{ message: 'Required', path: ['name'] }],
  environemntErrors: [{ message: 'Unauthorized', path: ['user'] }],
}
```

**New (composable-functions):**

```typescript
{
  success: false,
  errors: [
    new Error('Something went wrong'),
    new InputError('Required', ['name']),
    new ContextError('Unauthorized', ['user']),
  ],
}
```

### Success Result Comparison

**Domain Functions:**

```javascript
{ success: true, data: { name: 'John' }, errors: [], inputErrors: [], environmentErrors: [] }
```

**Composable Functions:**

```javascript
{ success: true, data: { name: 'John' }, errors: [] }
```

### Accessing Errors

**Domain Functions:**

```javascript
result.inputErrors[0]?.message
result.environmentErrors[0]?.message
result.errors[0]?.exception instanceof CustomError
```

**Composable Functions:**

```javascript
result.errors.find(isInputError)?.message
result.errors.find(isContextError)?.message
result.errors[0] instanceof CustomError
```

### Checking Error Types

**Collecting specific errors:**

```typescript
// replace this
if (result.inputErrors.length > 0) {
  return result.inputErrors[0].message
}
// with this
if (result.errors.some(isInputError)) {
  return result.errors.find(isInputError).message
}
```

### Helper Functions for Migration

Create helper functions to work with both libraries during migration:

```typescript
import type { Result as DFResult } from 'domain-functions'
import { isInputError, isContextError } from 'composable-functions'
import type { Result, SerializableResult } from 'composable-functions'

const isFormError = (result: SerializableResult | Result | DFResult) => {
  if ("inputErrors" in result) {
    return result.inputErrors.length > 0
  }
  return result.errors.some(isInputError)
}

const isEnvError = (result: SerializableResult | Result | CFResult) => {
  if ("environmentErrors" in result) {
    return result.environmentErrors.length > 0
  }
  return result.errors.some(isContextError)
}
```

### Replacing collectSequence

```typescript
// instead of
const df = collectSequence({
  name: nameDf,
  age: ageDf,
})

// you can do
const fn = map(sequence(nameFn, ageFn), ([name, age]) => ({ name, age }))
```

### Replacing merge

```typescript
// instead of
const df1 = makeDomainFunction()(() => ({ firstName: 'John' }))
const df2 = makeDomainFunction()(() => ({ lastName: 'Doe' }))
const df = merge(df1, df2)
//    ^? DomainFunction<{ firstName: string, lastName: string }>

// you can do
const fn1 = () => ({ firstName: 'John' })
const fn2 = () => ({ lastName: 'Doe' })
const fn = map(all(fn1, fn2), mergeObjects)
```

### Updated map Combinator

The mapping function now receives all original arguments:

```typescript
const add = (a: number, b: number) => a + b
const aggregateInputAndOutput = map(add, (result, a, b) => ({ result, a, b }))
//    ^? Composable<(a: number, b: number) => { result: number, a: number, b: number }>
```

### Updated trace Combinator

The tracing function now receives all original arguments:

```typescript
const fn = (a: number, b: number, c: number) => a + b + c
const withTrace = trace((...args) => console.log(...args))(fn)
const result = await withTrace(1, 2, 3)
// This will log: [{ success: true, data: 6, errors: [] }, 1, 2, 3]
```

### Renamed mapError to mapErrors

**Old:**

```typescript
import { mapError } from 'domain-functions'

const summarizeErrors = (result: ErrorData) =>
  ({
    errors: [{ message: 'Number of errors: ' + result.errors.length }],
    inputErrors: [
      { message: 'Number of input errors: ' + result.inputErrors.length },
    ],
    environmentErrors: [
      { message: 'Number of environment errors: ' + result.environmentErrors.length },
    ],
  } as ErrorData)

const incrementWithErrorSummary = mapError(increment, summarizeErrors)
```

**New:**

```typescript
import { mapErrors, isInputError, isContextError } from 'composable-functions'

const summarizeErrors = (errors: Error[]) =>
  [
    new Error('Number of errors: ' + errors.filter((e) => !isInputError(e) && !isContextError(e)).length),
    new InputError('Number of input errors: ' + errors.filter(isInputError).length),
    new ContextError('Number of context errors: ' + errors.filter(isContextError).length),
  ]

const incrementWithErrorSummary = mapErrors(increment, summarizeErrors)
```

### Test Updates

Update tests to check error names instead of separate arrays:

```typescript
// replace this
expect(result.inputErrors).containSubset([{ path: ['name'] }])
// with this
expect(result.errors).containSubset([{ name: 'InputError', path: ['name'] }])
```

## Code Examples

### Basic Composition

Traditional manual composition:

```typescript
function addAndReturnString(a: number, b: number): string {
  return toString(add(a, b))
}
```

With composable-functions:

```typescript
const addAndReturnString = pipe(add, toString)
```

### Error Handling Example

```typescript
import { composable, pipe } from 'composable-functions'

const faultyAdd = (a: number, b: number) => {
  if (a === 1) throw new Error('a is 1')
  return a + b
}
const show = (a: number) => String(a)
const addAndShow = pipe(faultyAdd, show)

const result = await addAndShow(2, 2)
/*
result = {
  success: true,
  data: "4",
  errors: []
}
*/
const failedResult = await addAndShow(1, 2)
/*
failedResult = {
  success: false,
  errors: [<Error object>]
}
*/
```

### Using fromSuccess for Data Fetching

```typescript
const getUser = composable((id: string) => db().collection('users').findOne({ id }))

const getProfile = composable(async (id: string) => {
  const user = await fromSuccess(getUser)(id)
  // ... some logic
  return { user, otherData }
})
```

### Merging Objects

```typescript
const a = { a: 1, b: 2 }
const b = { b: '3', c: '4' }
const result = mergeObjects([a, b])
//    ^? { a: number, b: string, c: string }
```

### Type Extraction

```typescript
const fn = composable()(async () => 'hey')

type Data = UnpackData<typeof fn>
//   ^? string
```

### React Router Example Structure

The library includes a React Router example application demonstrating real-world usage patterns.

**Development:**

```shellscript
npm run dev
```

**Build:**

```shellscript
npm run build
```

**Production:**

```shellscript
npm start
```

## Best Practices

1. **Always check success before accessing data** - TypeScript enforces this pattern
2. **Use specific error types** - InputError for validation, ContextError for authorization
3. **Prefer composition over manual nesting** - Use combinators like pipe, sequence, all
4. **Validate external inputs with applySchema** - Essential for API endpoints and forms
5. **Use withContext for context-heavy flows** - Simplifies passing context through pipelines
6. **Keep functions focused** - One composable should do one thing well
7. **Test with fromSuccess** - Unwrap results in tests for simpler assertions
8. **Serialize errors for transmission** - Use serialize helper when sending results over the wire
9. **Use catchFailure for optional operations** - Provide fallback values when failures are acceptable
10. **Leverage TypeScript inference** - Let the library infer types automatically

## Additional Resources

- GitHub Repository: https://github.com/seasonedcc/composable-functions
- Trust Score: 9.4
- Code Snippets Available: 95+
- Version: 5.0.0

---

*This documentation was compiled from Context7 on 2025-10-20*
