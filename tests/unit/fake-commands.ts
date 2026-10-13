import { execFileSync } from 'node:child_process'
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'

/**
 * Stand-ins for the system commands the package shells out to, put on PATH
 * for the rest of the test: a stand-in is a shell script run in the real
 * command's place, and `null` keeps the real command reachable. With `only`,
 * nothing else on the real PATH stays reachable.
 */
function fakeCommands(
  parent: string,
  commands: Record<string, string | null>,
  { only = false } = {},
) {
  const directory = mkdtempSync(join(parent, 'fake-commands-'))
  for (const [name, script] of Object.entries(commands)) {
    if (script === null) {
      symlinkSync(realCommand(name), join(directory, name))
    } else {
      writeFileSync(join(directory, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 })
    }
  }
  vi.stubEnv('PATH', only ? directory : `${directory}:${process.env.PATH}`)
}

function realCommand(name: string) {
  return execFileSync('/bin/sh', ['-c', `command -v ${name}`], {
    encoding: 'utf8',
  }).trim()
}

/**
 * A ps stand-in for the browser sweep, so it never lists a real browser: the
 * browser listing runs `browsers`, the process table runs `table` — the real
 * ps unless given — reads of given pids reach the real ps, and any other call
 * fails.
 */
function fakeBrowserPs(
  parent: string,
  { browsers, table }: { browsers: string; table?: string },
) {
  const ps = realCommand('ps')
  fakeCommands(parent, {
    ps: [
      'case "$*" in',
      `  *etime=*) ${browsers} ;;`,
      `  *lstart=*) ${table ?? `exec ${ps} "$@"`} ;;`,
      `  *" -p "*) exec ${ps} "$@" ;;`,
      '  *) exit 1 ;;',
      'esac',
    ].join('\n'),
  })
}

/** A browser listing that shows only the given processes, as the real ps lists them. */
function browserListingOf(processes: { pid: number }[]) {
  const wanted = processes.map(({ pid }) => `$1 == ${pid}`).join(' || ')
  return `${realCommand('ps')} "$@" | awk '${wanted || '0'}'`
}

export { browserListingOf, fakeBrowserPs, fakeCommands }
