import type {
  GateCommands,
  SeasonedSkillsConfig,
  StackConfig,
} from '../../config/types.js'
import { fillTokens, fragment } from '../fragments.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The testing skill ships two bodies. When the configuration declares the
 * stack the package ships, the full doctrine weaves in — unit-suite
 * discipline, the E2E harness architecture, the route coverage gate, seed
 * convergence, retry safety, and CI-failure diagnosis — plus a worked-examples
 * reference file beside it. When the project runs a stack the package does not
 * ship, the skill is a thin pointer at the project's own committed playbook,
 * whose location the project states in its testing content file.
 */
export function composeTesting(context: GenerationContext): GeneratedFile[] {
  const { stack } = context.config
  const body = stack
    ? fullBody(context.config, stack)
    : fragment('skills/testing/pointer.md')

  const skill = composeSkill('testing', context, {
    tokens: { 'testing-body': body },
  })

  if (!stack) return [skill]
  return [
    skill,
    {
      path: '.claude/skills/testing/references/examples.md',
      contents: `${fragment('skills/testing/references/examples.md')}\n`,
    },
  ]
}

function fullBody(config: SeasonedSkillsConfig, stack: StackConfig): string {
  return fillTokens(fragment('skills/testing/full.md'), {
    'gate-commands': gateCommands(config.gates),
    'database-write-rule': databaseWriteRule(stack),
    'coverage-register': registerReference(config.webSurface?.coverageRegister),
    'excused-surfaces': registerReference(config.webSurface?.excusedSurfaces),
  })
}

function gateCommands(gates: GateCommands): string {
  const lines = [
    gates.unit && `${gates.unit}   # every unit test`,
    gates.relatedSpecs &&
      `${gates.relatedSpecs}   # the specs related to a change, chosen by blast radius`,
  ].filter((line): line is string => typeof line === 'string')
  if (lines.length === 0) {
    return "The project's gate commands are listed in the generated instructions."
  }
  return ['```bash', ...lines, '```'].join('\n')
}

function databaseWriteRule(stack: StackConfig): string {
  return stack.databaseMutability === 'append-only'
    ? 'Never delete or update records in unit tests — the schema is append-only, and tests follow the same doctrine'
    : 'Never delete records in unit tests'
}

function registerReference(path: string | undefined): string {
  return path === undefined ? 'the file the configuration names' : `\`${path}\``
}
