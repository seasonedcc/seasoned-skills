import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'

describe('CLI surface', () => {
  it('matches the pinned command surface', () => {
    const program = buildProgram()
    const surface = {
      name: program.name(),
      commands: program.commands.map((command) => ({
        name: command.name(),
        description: command.description(),
      })),
    }
    expect(surface).toMatchSnapshot()
  })
})
