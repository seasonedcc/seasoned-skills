import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { collectAnswers } from '../../src/install/interactive.js'

/**
 * Runs the interview against a scripted list of answers. Prompts end without a
 * newline, so each un-terminated output chunk is a question waiting for the
 * next answer; a line readline is not waiting for would be dropped, which is
 * why the answers cannot simply be written up front.
 */
function interview(root: string, answers: string[]) {
  const input = new PassThrough()
  const output = new PassThrough()
  const queue = [...answers]
  output.on('data', (chunk: Buffer) => {
    if (chunk.toString().endsWith('\n')) return
    const answer = queue.shift()
    if (answer !== undefined) setImmediate(() => input.write(`${answer}\n`))
  })
  return collectAnswers(root, { input, output })
}

describe('collectAnswers', () => {
  it('collects a minimal deployed-product project, honoring defaults', async () => {
    const answers = await interview('/tmp/consumer', [
      '', // project name → defaults to the directory name
      '', // content dir → workflow-content
      '', // merge strategy → merge-commit
      'autofix',
      'deployed-product',
      'pnpm lint', // lint
      '-', // typecheck: none
      'pnpm test', // unit
      '-', // related specs: none
      'pnpm test:all', // full gate
      'no', // another full gate?
      '', // calibration file → default
      'no', // web surface?
      'no', // demo seed?
      'no', // machine surface?
      'no', // stack layer?
    ])
    expect(answers).toEqual({
      projectName: 'consumer',
      contentDir: 'workflow-content',
      mergeStrategy: 'merge-commit',
      outOfScopeFindings: 'autofix',
      release: { target: 'deployed-product' },
      gates: { lint: 'pnpm lint', unit: 'pnpm test', full: ['pnpm test:all'] },
      calibrationFile: 'workflow-content/calibrations.md',
    })
  })

  it('collects every option: packages, surfaces, and the stack declarations', async () => {
    const answers = await interview('/tmp/webapp', [
      'webapp',
      'content',
      'squash',
      'bank',
      'published-package',
      'first-package',
      'pnpm publish:first',
      'yes', // another package
      'second-package',
      'pnpm publish:second',
      'no', // no more packages
      '-', // lint
      'pnpm tsc', // typecheck
      '-', // unit
      '-', // related specs
      'pnpm e2e', // full gate
      'no',
      'calibration.md',
      'yes', // web surface
      '', // coverage register → default under content/
      '', // excused surfaces → default
      'yes', // demo seed
      '', // manifest → default
      'yes', // machine surface
      '', // parity standard → default
      '', // exception register → default
      'yes', // stack layer
      'append-only',
      'Context and Database from app/context.ts',
      '', // application root → app
      'Times display in the venue timezone.',
    ])
    expect(answers.release).toEqual({
      target: 'published-package',
      packages: [
        { name: 'first-package', publishCommand: 'pnpm publish:first' },
        { name: 'second-package', publishCommand: 'pnpm publish:second' },
      ],
    })
    expect(answers.gates).toEqual({ typecheck: 'pnpm tsc', full: ['pnpm e2e'] })
    expect(answers.webSurface).toEqual({
      coverageRegister: 'content/coverage-register.md',
      excusedSurfaces: 'content/excused-surfaces.md',
    })
    expect(answers.demoSeed).toEqual({ seedManifest: 'content/seed-manifest.md' })
    expect(answers.machineSurface).toEqual({
      parityStandard: 'content/parity-standard.md',
      exceptionRegister: 'content/exception-register.md',
    })
    expect(answers.stack).toEqual({
      databaseMutability: 'append-only',
      keyTypes: 'Context and Database from app/context.ts',
      applicationRoot: 'app',
      timeZoneModel: 'Times display in the venue timezone.',
    })
  })

  it('re-asks until an answer matches the offered choices', async () => {
    const answers = await interview('/tmp/consumer', [
      'consumer',
      'workflow-content',
      'rebase', // not a choice — re-asked
      'squash',
      'bank',
      'deployed-product',
      '-',
      '-',
      '-',
      '-',
      'pnpm gate',
      'no',
      '',
      'no',
      'no',
      'no',
      'no',
    ])
    expect(answers.mergeStrategy).toBe('squash')
  })
})
