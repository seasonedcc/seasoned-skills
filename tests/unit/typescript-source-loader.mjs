import { register } from 'node:module'

/**
 * Lets a child Node process run the command line straight from `src/`, as a
 * test needs when it wants real processes: the sources import each other by
 * their compiled `.js` names, so a `.js` that does not exist resolves to the
 * `.ts` beside it, which Node then runs with its types removed.
 */
const resolveToTypeScript = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || !specifier.endsWith('.js')) throw error
    return nextResolve(\`\${specifier.slice(0, -3)}.ts\`, context)
  }
}
`

register(`data:text/javascript,${encodeURIComponent(resolveToTypeScript)}`)
