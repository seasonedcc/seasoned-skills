import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'
import { configurationKeyPaths } from '../../src/config/keys.js'
import { SKILL_NAMES } from '../../src/generation/skills/index.js'
import * as packageExports from '../../src/index.js'

/**
 * The reference pages are written by hand, so nothing but a test keeps the
 * names on them true. Every name the package really has — commands, flags,
 * configuration keys, runtime exports, generated skills — is enumerated from
 * the thing itself and matched against what the pages document, in both
 * directions: a name the pages miss fails, and so does a name they still
 * carry after the package dropped it.
 *
 * The pages hold their names in tables whose first column is labelled for the
 * kind it lists — Command, Flag, Key, Export, Skill — and a command's flags
 * belong to the section headed with that command. The golden tier still pins
 * the command names and descriptions themselves; this test ties the whole
 * surface to the documentation.
 */
const PAGE_NAMES = [
  'commands',
  'configuration',
  'what-a-project-receives',
  'managed-footprint',
]

interface DocumentedTable {
  /** The nearest heading above the table, which scopes a command's flags. */
  heading: string
  /** The first column's header cell, naming the kind the table lists. */
  label: string
  names: string[]
}

const tables = PAGE_NAMES.flatMap((page) =>
  tablesIn(
    readFileSync(
      fileURLToPath(new URL(`../../docs/reference/${page}.md`, import.meta.url)),
      'utf8',
    ),
  ),
)

describe('the reference pages', () => {
  it('documents every command', () => {
    const program = buildProgram()
    expect(sorted(documented('Command'))).toEqual(
      sorted(program.commands.map((command) => command.name())),
    )
  })

  it("documents every flag, under its own command's section", () => {
    const program = buildProgram()
    const real = new Map<string, string[]>()
    const sources = [
      [program.name(), program.options] as const,
      ...program.commands.map(
        (command) => [`${program.name()} ${command.name()}`, command.options] as const,
      ),
    ]
    for (const [heading, options] of sources) {
      if (options.length === 0) continue
      real.set(
        heading,
        options.map((option) => option.long ?? option.flags),
      )
    }

    const byHeading = new Map<string, string[]>()
    for (const table of tables) {
      if (table.label !== 'Flag') continue
      const flags = table.names.map(longFlag)
      byHeading.set(table.heading, [...(byHeading.get(table.heading) ?? []), ...flags])
    }

    expect(sortedGroups(byHeading)).toEqual(sortedGroups(real))
  })

  it('documents every configuration key, at full depth', () => {
    expect(sorted(documented('Key'))).toEqual(sorted(configurationKeyPaths()))
  })

  it('documents every runtime export', () => {
    expect(sorted(documented('Export'))).toEqual(sorted(Object.keys(packageExports)))
  })

  it('documents every skill the package can generate', () => {
    expect(sorted(documented('Skill'))).toEqual(sorted(SKILL_NAMES))
  })
})

function documented(label: string): string[] {
  return tables.filter((table) => table.label === label).flatMap((table) => table.names)
}

function sorted(names: readonly string[]): string[] {
  return [...names].sort()
}

function sortedGroups(groups: Map<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    [...groups].map(([heading, names]) => [heading, sorted(names)]),
  )
}

/** A flag cell may spell out its argument or its short form; the long flag names it. */
function longFlag(cell: string): string {
  return cell.match(/--[a-z][a-z0-9-]*/)?.[0] ?? cell
}

function tablesIn(markdown: string): DocumentedTable[] {
  const found: DocumentedTable[] = []
  let heading = ''
  let rows: string[][] = []

  const closeTable = () => {
    const [header, divider, ...body] = rows
    rows = []
    if (header === undefined || divider === undefined) return
    if (!divider.every((cell) => /^:?-{3,}:?$/.test(cell))) return
    found.push({
      heading,
      label: header[0] ?? '',
      names: body.map((row) => (row[0] ?? '').replaceAll('`', '').trim()),
    })
  }

  let fenced = false
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      closeTable()
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (trimmed.startsWith('|')) {
      rows.push(
        trimmed
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
      continue
    }
    closeTable()
    if (trimmed.startsWith('#')) heading = trimmed.replace(/^#+\s*/, '')
  }
  closeTable()
  return found
}
