import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Prose lives as markdown fragments; weaving is code. This module is the whole
 * bridge between the two: fragments are read from the package's `content/`
 * tree, and the only substitution they support is a flat token fill — every
 * conditional lives in typed composition functions, never in the fragments.
 */

const contentRoot = fileURLToPath(new URL('../../content/', import.meta.url))

export function fragment(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${contentRoot}`), 'utf8').trimEnd()
}

/**
 * Fills `{{token}}` markers in a fragment. Throws on a marker the values do
 * not cover — an unfilled token in generated doctrine is a generation bug,
 * never something to ship.
 */
export function fillTokens(text: string, values: Record<string, string>): string {
  return text.replaceAll(/\{\{([a-zA-Z][a-zA-Z0-9-]*)\}\}/g, (match, token: string) => {
    const value = values[token]
    if (value === undefined) throw new Error(`unfilled token ${match}`)
    return value
  })
}

/** Joins present blocks with blank lines, dropping the conditionals that are off. */
export function joinBlocks(...blocks: Array<string | undefined | false>): string {
  return `${blocks
    .filter((block): block is string => typeof block === 'string' && block.length > 0)
    .map((block) => block.trimEnd())
    .join('\n\n')}\n`
}
