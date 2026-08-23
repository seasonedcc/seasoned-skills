import { createRequire } from 'node:module'
import { Command } from 'commander'

const require = createRequire(import.meta.url)
const { version } = require('../../package.json') as { version: string }

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('seasoned-skills')
    .description(
      'The Seasoned workflow — installed with one command and kept current by upgrading a version.',
    )
    .version(version)

  return program
}
