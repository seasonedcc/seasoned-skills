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
      const real = execFileSync('/bin/sh', ['-c', `command -v ${name}`], {
        encoding: 'utf8',
      }).trim()
      symlinkSync(real, join(directory, name))
    } else {
      writeFileSync(join(directory, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 })
    }
  }
  vi.stubEnv('PATH', only ? directory : `${directory}:${process.env.PATH}`)
}

export { fakeCommands }
