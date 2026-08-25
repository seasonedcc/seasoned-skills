import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { applyInstall, planInstall } from '../../src/install/install.js'
import { collectAnswers } from '../../src/install/interactive.js'

/**
 * Runs the interview against a scripted list of answers, one written each time
 * a prompt appears — the way a person at a terminal answers. Prompts end
 * without a newline, so an un-terminated output chunk is a question waiting.
 */
async function interview(root: string, answers: string[]) {
  const input = new PassThrough()
  const output = new PassThrough()
  const queue = [...answers]
  output.on('data', (chunk: Buffer) => {
    if (chunk.toString().endsWith('\n')) return
    const answer = queue.shift()
    if (answer !== undefined) setImmediate(() => input.write(`${answer}\n`))
  })
  return (await collectAnswers(root, { input, output })).answers
}

/** Runs the interview against answers piped in all at once, as a script does. */
function pipedInterview(root: string, answers: string[]) {
  const input = new PassThrough()
  const output = new PassThrough()
  output.resume()
  input.end(answers.map((answer) => `${answer}\n`).join(''))
  return collectAnswers(root, { input, output })
}

const minimalAnswers = [
  'consumer',
  'workflow-content',
  'merge-commit',
  'bank',
  'deployed-product',
  'pnpm check',
  '-',
  'pnpm test:unit',
  '-',
  'pnpm test',
  'no',
  'workflow-content/calibrations.md',
  'no',
  'no',
  'no',
  'no',
]

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

  it('answers in order from piped input, and the scaffold lands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'seasoned-skills-piped-'))
    try {
      const { answers } = await pipedInterview(root, minimalAnswers)
      expect(answers.projectName).toBe('consumer')
      expect(answers.gates).toEqual({
        lint: 'pnpm check',
        unit: 'pnpm test:unit',
        full: ['pnpm test'],
      })
      applyInstall(root, planInstall(root, answers))
      expect(readFileSync(join(root, 'seasoned-skills.config.ts'), 'utf8')).toContain(
        "projectName: 'consumer'",
      )
      expect(
        readFileSync(join(root, 'workflow-content/calibrations.md'), 'utf8'),
      ).toContain('Subagent calibrations')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('aborts loudly when the input ends before the last answer', async () => {
    await expect(
      pipedInterview('/tmp/consumer', minimalAnswers.slice(0, 4)),
    ).rejects.toThrow(/install interview ended before it was answered/)
  })

  it('asks for the book only when the shaping corpus still has to be built', async () => {
    const withoutCorpus = await pipedInterview('/tmp/consumer', [
      ...minimalAnswers,
      '/Users/someone/books/demand-side-sales',
    ])
    expect(withoutCorpus.bookPath).toBeUndefined()

    const input = new PassThrough()
    const output = new PassThrough()
    output.resume()
    input.end(
      [...minimalAnswers, '/Users/someone/books/demand-side-sales']
        .map((answer) => `${answer}\n`)
        .join(''),
    )
    const asked = await collectAnswers('/tmp/consumer', {
      input,
      output,
      corpusNeedsBuilding: true,
    })
    expect(asked.bookPath).toBe('/Users/someone/books/demand-side-sales')
  })

  it('takes an empty book answer as no copy of the book', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    output.resume()
    input.end([...minimalAnswers, ''].map((answer) => `${answer}\n`).join(''))
    const asked = await collectAnswers('/tmp/consumer', {
      input,
      output,
      corpusNeedsBuilding: true,
    })
    expect(asked.bookPath).toBeUndefined()
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
