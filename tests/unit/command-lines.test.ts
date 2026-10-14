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
const INVOCATION = 'pnpm exec'

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
    `(?<!${INVOCATION} )\\b${program.name()} (${subcommands.join('|')})\\b`,
  )
  const lines = SHIPPED.flatMap(shippedFiles).flatMap(linesToRead)

  it('runs every command through the package manager', () => {
    const bare = lines
      .filter(({ text }) => bareCommand.test(withoutWrittenBare(text)))
      .map(({ path, number, text }) => `${path}:${number}: ${text.trim()}`)
    expect(subcommands).not.toEqual([])
    expect(bare).toEqual([])
  })

  it('still finds every text a bare command is right in', () => {
    const unused = WRITTEN_BARE.filter(
      (allowed) => !lines.some(({ text }) => text.includes(allowed)),
    )
    expect(unused).toEqual([])
  })
})

interface Line {
  path: string
  number: number
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
 * A file's lines, minus the markdown headings — a heading names a command, as
 * the commands reference does section by section, and is never run.
 */
function linesToRead(file: string): Line[] {
  const contents = readFileSync(file)
  if (contents.includes(0)) return []
  const path = relative(root, file)
  const markdown = file.endsWith('.md')
  let fenced = false
  return contents
    .toString('utf8')
    .split('\n')
    .flatMap((text, index) => {
      if (markdown && text.trim().startsWith('```')) fenced = !fenced
      if (markdown && !fenced && /^#{1,6} /.test(text)) return []
      return [{ path, number: index + 1, text }]
    })
}

function withoutWrittenBare(text: string): string {
  return WRITTEN_BARE.reduce(
    (remaining, allowed) => remaining.replaceAll(allowed, ''),
    text,
  )
}
