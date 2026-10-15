import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'

interface CommandSurface {
  name: string
  description: string
  commands?: CommandSurface[]
}

/** A command's name and description, and its own commands' at any depth. */
function surfaceOf(command: Command): CommandSurface {
  return {
    name: command.name(),
    description: command.description(),
    ...(command.commands.length === 0
      ? {}
      : { commands: command.commands.map(surfaceOf) }),
  }
}

describe('CLI surface', () => {
  it('matches the pinned command surface', () => {
    const program = buildProgram()
    const surface = {
      name: program.name(),
      commands: program.commands.map(surfaceOf),
    }
    expect(surface).toMatchSnapshot()
  })
})
