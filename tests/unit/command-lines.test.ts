import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'
import { SYNC_COMMAND } from '../../src/footprint/scripts.js'

/**
 * A project installs the package as a dependency, so its binary is never on
 * PATH: a bare `seasoned-skills provision` answers "command not found" in a
 * consumer's shell and in every agent's. Every command line the package ships
 * runs through the package manager instead, and this test reads everything
 * shipped — the content the skills and doctrine are woven from, the docs, the
 * runtime scripts, the strings the CLI prints, and the generated output the
 * golden tier pins — for a command written without it. The subcommands come
 * from the CLI itself, so a new command is covered the day it lands.
 */
const SHIPPED = [
  'content',
  'workflow-content',
  'docs',
  'README.md',
  'runtime',
  'src',
  'tests/golden/__output__',
]

/**
 * The text a bare command is right in. The `prepare` script is run by the
 * package manager, which puts the project's binaries on PATH for it, and the
 * corpus crawler's user agent names the package rather than running it.
 */
const WRITTEN_BARE = [
  `SYNC_COMMAND = '${SYNC_COMMAND}'`,
  `becomes \`${SYNC_COMMAND}\``,
  `&& ${SYNC_COMMAND}\``,
  'seasoned-skills corpus builder',
]

const root = fileURLToPath(new URL('../../', import.meta.url))

describe('shipped command lines', () => {
  const program = buildProgram()
  const subcommands = program.commands.map((command) => command.name())
  const bareCommand = new RegExp(
    `(?<!pnpm\\s+exec\\s+)\\b${program.name()}\\s+(${subcommands.join('|')})\\b`,
    'g',
  )
  const files = SHIPPED.flatMap(shippedFiles).flatMap(textToRead)

  it('runs every command through the package manager', () => {
    const bare = files.flatMap(({ path, text }) =>
      [...withoutWrittenBare(text).matchAll(bareCommand)].map(
        (match) =>
          `${path}:${text.slice(0, match.index).split('\n').length}: ${match[0]}`,
      ),
    )
    expect(subcommands).not.toEqual([])
    expect(bare).toEqual([])
  })

  it('still finds every text a bare command is right in', () => {
    const unused = WRITTEN_BARE.filter(
      (allowed) => !files.some(({ text }) => text.includes(allowed)),
    )
    expect(unused).toEqual([])
  })
})

interface ShippedText {
  path: string
  text: string
}

function shippedFiles(entry: string): string[] {
  const path = join(root, entry)
  if (statSync(path).isFile()) return [path]
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((found) => found.isFile() && !found.name.endsWith('.test.ts'))
    .map((found) => join(found.parentPath, found.name))
}

/**
 * A file's text with its markdown headings blanked — a heading names a
 * command, as the commands reference does section by section, and is never
 * run. A blanked line keeps its place, so every match keeps its line number.
 */
function textToRead(file: string): ShippedText[] {
  const contents = readFileSync(file)
  if (contents.includes(0)) return []
  const markdown = file.endsWith('.md')
  let fenced = false
  const text = contents
    .toString('utf8')
    .split('\n')
    .map((line) => {
      if (markdown && line.trim().startsWith('```')) fenced = !fenced
      return markdown && !fenced && /^#{1,6} /.test(line) ? '' : line
    })
    .join('\n')
  return [{ path: relative(root, file), text }]
}

function withoutWrittenBare(text: string): string {
  return WRITTEN_BARE.reduce(
    (remaining, allowed) => remaining.replaceAll(allowed, ' '.repeat(allowed.length)),
    text,
  )
}
