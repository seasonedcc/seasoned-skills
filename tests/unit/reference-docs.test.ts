import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Argument, Command } from 'commander'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'
import { configurationKeyPaths } from '../../src/config/keys.js'
import { corpusReferencesDir } from '../../src/corpus/cache.js'
import {
  MANAGED_HOOKS,
  MANAGED_RUNTIME_VALUES,
  type ManagedHook,
  mergeManagedSettings,
} from '../../src/footprint/settings.js'
import { SKILL_NAMES } from '../../src/generation/skills/index.js'
import * as packageExports from '../../src/index.js'
import { MANIFEST_PATH } from '../../src/sync/manifest.js'
import { composeGeneratedFiles, ignoreEntries } from '../../src/sync/sync.js'
import { loadFixture } from '../golden/helpers.js'

/**
 * The reference pages are written by hand, so nothing but a test keeps the
 * names on them true. Every name the package really has — commands, flags,
 * positional arguments, configuration keys, runtime exports, generated skills,
 * every path a sync writes, and the whole managed footprint — is enumerated
 * from the thing itself and matched against what the pages document. Most of
 * them run in both directions: a name the pages miss fails, and so does a name
 * they still carry after the package dropped it.
 *
 * The two the pages carry in prose rather than in a table run one way only. A
 * command's positional arguments and the names of the exported types have to
 * appear where a reader would look for them; a name the package drops while
 * the prose keeps promising it is left to the review pass.
 *
 * The pages hold their names in tables whose first column is labelled for the
 * kind it lists — Command, Flag, Key, Export, Skill, File, Setting, Hook,
 * Entry. The Command table lists the top-level commands; every command, at
 * any depth, has a section headed with its full name — `seasoned-skills
 * ledger search` — and its flags and positional arguments belong there. A
 * section runs from its heading to the next heading of any level, so the
 * commands page heads each top-level command with `##` and each nested one
 * with `###`, and a nested section ends its parent's. The golden tier still
 * pins the command names and descriptions themselves; this test ties the
 * whole surface to the documentation.
 */
const PAGE_NAMES = [
  'commands',
  'configuration',
  'what-a-project-receives',
  'managed-footprint',
]

interface Section {
  /** The heading's text, at whatever level. */
  heading: string
  /** Everything from the heading down to the next heading of any level. */
  body: string
}

interface DocumentedTable {
  /** The heading of the section holding the table, which scopes a command's flags. */
  heading: string
  /** The first column's header cell, naming the kind the table lists. */
  label: string
  /** Every body row's cells, with the markdown backticks taken off. */
  rows: string[][]
}

const tables = PAGE_NAMES.flatMap((page) => tablesIn(pageSource(page)))

describe('the reference pages', () => {
  it('documents every command', () => {
    const program = buildProgram()
    expect(sorted(documented('Command'))).toEqual(
      sorted(program.commands.map((command) => command.name())),
    )
  })

  it('gives every command, at any depth, a section under its full name', () => {
    const headings = sectionsIn(pageSource('commands')).map((section) => section.heading)
    const missing = commandTree(buildProgram())
      .map(({ fullName }) => fullName)
      .filter((fullName) => !headings.includes(fullName))
    expect(missing).toEqual([])
  })

  it("documents every flag, under its own command's section", () => {
    const real = new Map<string, string[]>()
    for (const { fullName, command } of commandTree(buildProgram())) {
      if (command.options.length === 0) continue
      real.set(
        fullName,
        command.options.map((option) => option.flags),
      )
    }

    const byHeading = new Map<string, string[]>()
    for (const table of tables) {
      if (table.label !== 'Flag') continue
      const flags = table.rows.map((row) => row[0] ?? '')
      byHeading.set(table.heading, [...(byHeading.get(table.heading) ?? []), ...flags])
    }

    expect(sortedGroups(byHeading)).toEqual(sortedGroups(real))
  })

  it("documents every positional argument, in its own command's section", () => {
    const sections = sectionsIn(pageSource('commands'))
    const checked: string[] = []
    for (const { fullName, command } of commandTree(buildProgram())) {
      const section = sections.find(({ heading }) => heading === fullName)?.body ?? ''
      for (const argument of command.registeredArguments) {
        expect(section).toContain(argumentToken(argument))
        checked.push(argument.name())
      }
    }
    expect(checked).not.toEqual([])
  })

  it('documents every configuration key, at full depth', () => {
    expect(sorted(documented('Key'))).toEqual(sorted(configurationKeyPaths()))
  })

  it('documents every runtime export', () => {
    expect(sorted(documented('Export'))).toEqual(sorted(Object.keys(packageExports)))
  })

  it('documents every type the package exports', () => {
    const page = pageSource('what-a-project-receives')
    const names = exportedTypeNames()
    expect(names).not.toEqual([])
    for (const name of names) {
      expect(page).toContain(`\`${name}\``)
    }
  })

  it('documents every skill the package can generate', () => {
    expect(sorted(documented('Skill'))).toEqual(sorted(SKILL_NAMES))
  })

  it('documents every setting a sync enforces', () => {
    expect(sorted(documented('Setting'))).toEqual(sorted(enforcedSettingNames()))
  })

  it('documents the value of every package-versioned setting', () => {
    const documentedValues = new Map(
      documentedRows('Setting').map((row) => [row[0], row[1]]),
    )
    for (const [key, value] of Object.entries(MANAGED_RUNTIME_VALUES)) {
      expect(documentedValues.get(key)).toBe(String(value))
    }
  })

  it('documents every hook a sync registers', () => {
    expect(documentedRows('Hook')).toEqual(
      MANAGED_HOOKS.map((hook) => [
        hookName(hook),
        hook.script,
        `${hook.timeout} seconds`,
      ]),
    )
  })

  describe('against a whole generation', () => {
    let generatedPaths: string[]
    let corpusCache: string

    beforeAll(async () => {
      corpusCache = mkdtempSync(join(tmpdir(), 'seasoned-skills-reference-corpus-'))
      const references = corpusReferencesDir(corpusCache)
      mkdirSync(references, { recursive: true })
      writeFileSync(join(references, 'a-cached-reference.md'), 'Cached prose.\n')
      // The fullest configuration there is: every option-gated layer turned on,
      // so every path a project could ever receive is in this run.
      const context = await loadFixture('web-append-only')
      generatedPaths = [
        ...composeGeneratedFiles(context, corpusCache).map((file) => file.path),
        MANIFEST_PATH,
      ]
    })

    afterAll(() => {
      rmSync(corpusCache, { recursive: true, force: true })
    })

    it('accounts for every path a sync generates', () => {
      expect(generatedPaths.filter((path) => rowCovering(path) === undefined)).toEqual([])
      const covering = new Set(generatedPaths.flatMap((path) => rowCovering(path) ?? []))
      expect(sorted([...covering])).toEqual(
        sorted(documented('File', 'What a sync generates')),
      )
    })

    it('documents every ignore entry a sync maintains', () => {
      const entries = new Set(ignoreEntries(generatedPaths).map(perSkillFolder))
      expect(sorted([...entries])).toEqual(sorted(documented('Entry')))
    })
  })
})

function pageSource(page: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../docs/reference/${page}.md`, import.meta.url)),
    'utf8',
  )
}

function documentedRows(label: string, heading?: string): string[][] {
  return tables
    .filter((table) => table.label === label)
    .filter((table) => heading === undefined || table.heading === heading)
    .flatMap((table) => table.rows)
}

function documented(label: string, heading?: string): string[] {
  return documentedRows(label, heading).map((row) => row[0] ?? '')
}

function sorted(names: readonly string[]): string[] {
  return [...names].sort()
}

function sortedGroups(groups: Map<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    [...groups].map(([heading, names]) => [heading, sorted(names)]),
  )
}

/** The program and every command under it, at any depth, each with its full name. */
function commandTree(
  command: Command,
  parentName?: string,
): { fullName: string; command: Command }[] {
  const fullName =
    parentName === undefined ? command.name() : `${parentName} ${command.name()}`
  return [
    { fullName, command },
    ...command.commands.flatMap((subcommand) => commandTree(subcommand, fullName)),
  ]
}

/** The way a usage line writes one argument: `<lane>`, `[base]`, `<paths...>`. */
function argumentToken(argument: Argument): string {
  const name = `${argument.name()}${argument.variadic ? '...' : ''}`
  return argument.required ? `<${name}>` : `[${name}]`
}

/** The `export type` names in the package entry point, which erase at runtime. */
function exportedTypeNames(): string[] {
  const entry = readFileSync(
    fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
    'utf8',
  )
  return [...entry.matchAll(/export type \{([^}]*)\}/g)].flatMap((match) =>
    (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== ''),
  )
}

const KEPT_AS_WRITTEN = 'the value the project already had'

/**
 * Every setting sync enforces, named the way the page names it: a key whose
 * value a merge overwrites whatever the file already held. `$schema` is filled
 * in only when it is missing, so it is not enforced and the page carries it in
 * prose; the permissions block is named by the one key inside it the package
 * manages, since the rest of the block is the project's own.
 */
function enforcedSettingNames(): string[] {
  const managed = mergeManagedSettings({})
  const afterExisting = mergeManagedSettings(
    Object.fromEntries(Object.keys(managed).map((key) => [key, KEPT_AS_WRITTEN])),
  )
  const permissions = managed.permissions as Record<string, unknown>
  return Object.keys(managed)
    .filter((key) => afterExisting[key] !== KEPT_AS_WRITTEN)
    .flatMap((key) =>
      key === 'permissions'
        ? Object.keys(permissions).map((nested) => `permissions.${nested}`)
        : [key],
    )
}

/** The page names a hook by its event, and by what it matches when it matches. */
function hookName(hook: ManagedHook): string {
  return hook.matcher === undefined
    ? hook.event
    : `${hook.event}, matching ${hook.matcher}`
}

/** The managed block writes one entry per generated skill; the page writes one row. */
function perSkillFolder(entry: string): string {
  return /^\.claude\/skills\/[^/]+\/$/.test(entry) ? '.claude/skills/<name>/' : entry
}

/** The rows on "What a sync generates" that name one file each. */
const DOCUMENTED_FILES = [
  'CLAUDE.md',
  MANIFEST_PATH,
  '.claude/statusline.sh',
  '.claude/skills/requests-from-meetings/scripts/verify.py',
  'requests-from-meetings/assets/style.css',
]

/** The rows that name a whole directory, matched in order: narrower ones first. */
const DOCUMENTED_DIRECTORIES = [
  '.claude/hooks/',
  '.claude/skills/demo-videos/scripts/',
  '.claude/skills/shaping/references/',
  'shaping/assets/',
]

/**
 * The row on "What a sync generates" that accounts for a generated path, or
 * nothing at all. Every path has to land on a row, so a path the pages never
 * mention fails the gate instead of disappearing into a neighbouring prefix.
 */
function rowCovering(path: string): string | undefined {
  if (DOCUMENTED_FILES.includes(path)) return path
  const directory = DOCUMENTED_DIRECTORIES.find((prefix) => path.startsWith(prefix))
  if (directory !== undefined) return directory
  if (/^\.claude\/skills\/[^/]+\//.test(path)) return '.claude/skills/<name>/'
  return undefined
}

/**
 * Each section of a page: a heading at any level and the text under it, down
 * to the next heading of any level. A line inside a fenced block is never a
 * heading, whatever it starts with.
 */
function sectionsIn(markdown: string): Section[] {
  const sections: Section[] = []
  let current: Section | undefined
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (line.trim().startsWith('```')) fenced = !fenced
    const heading = fenced ? undefined : line.match(/^#{1,6}\s+(.*)$/)?.[1]
    if (heading !== undefined) {
      current = { heading, body: '' }
      sections.push(current)
      continue
    }
    if (current !== undefined) current.body += `${line}\n`
  }
  return sections
}

function tablesIn(markdown: string): DocumentedTable[] {
  return sectionsIn(markdown).flatMap(({ heading, body }) =>
    tablesInSection(heading, body),
  )
}

function tablesInSection(heading: string, body: string): DocumentedTable[] {
  const found: DocumentedTable[] = []
  let rows: string[][] = []

  const closeTable = () => {
    const [header, divider, ...rest] = rows
    rows = []
    if (header === undefined || divider === undefined) return
    if (!divider.every((cell) => /^:?-{3,}:?$/.test(cell))) return
    found.push({
      heading,
      label: header[0] ?? '',
      rows: rest.map((row) => row.map((cell) => cell.replaceAll('`', '').trim())),
    })
  }

  let fenced = false
  for (const line of body.split('\n')) {
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
  }
  closeTable()
  return found
}
