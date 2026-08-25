import { basename } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { REGISTER_CONTENT_NAMES } from '../generation/skills/index.js'
import type { InstallAnswers } from './install.js'

export interface InterviewOptions {
  input?: Readable
  output?: Writable
  /**
   * Ask for the user's own copy of the commercial book: this machine's shaping
   * corpus cache is missing or stale, so the install has to build it.
   */
  corpusNeedsBuilding?: boolean
}

export interface InstallInterview {
  answers: InstallAnswers
  /** The path the user gave for their own copy of the book, when they have one. */
  bookPath?: string
}

/** An interview that ran out of input before it had every answer it needs. */
export class InstallInterviewAborted extends Error {
  constructor(readonly question: string) {
    super(
      `the install interview ended before it was answered: "${question}". Run \`seasoned-skills install\` in a terminal, or pipe one line for every question it asks.`,
    )
    this.name = 'InstallInterviewAborted'
  }
}

/**
 * The install interview. An option the rulings give a default is stated in
 * the scaffold without a question; an option with no ruled default is a
 * declaration the install asks for — nothing defaults silently. The stack
 * skills' required declarations (key types, application root, time-zone
 * model) are asked here too, so the first sync never fails on an empty
 * required section.
 *
 * Answers are read through readline's async iterator, which buffers whole
 * lines: an install driven by piped input answers in order, exactly as a
 * person typing would, and input that runs out before the last answer aborts
 * loudly instead of leaving the interview hanging.
 */
export async function collectAnswers(
  projectRoot: string,
  options: InterviewOptions = {},
): Promise<InstallInterview> {
  const output = options.output ?? process.stdout
  const rl = createInterface({
    input: options.input ?? process.stdin,
    output,
  })
  const lines = rl[Symbol.asyncIterator]()
  const ask = async (question: string, fallback?: string): Promise<string> => {
    const suffix = fallback ? ` [${fallback}]` : ''
    output.write(`${question}${suffix} `)
    const line = await lines.next()
    if (line.done) throw new InstallInterviewAborted(question)
    const answer = line.value.trim()
    if (answer) return answer
    if (fallback !== undefined) return fallback
    return ask(question, fallback)
  }
  const askChoice = async <T extends string>(
    question: string,
    choices: readonly T[],
  ): Promise<T> => {
    const answer = await ask(`${question} (${choices.join(' | ')})`, choices[0])
    if ((choices as readonly string[]).includes(answer)) return answer as T
    output.write(`Answer must be one of: ${choices.join(', ')}\n`)
    return askChoice(question, choices)
  }
  const askYesNo = async (question: string): Promise<boolean> =>
    (await askChoice(question, ['no', 'yes'])) === 'yes'

  try {
    const projectName = await ask('Project name?', basename(projectRoot))
    const contentDir = await ask(
      'Directory for project-owned workflow content?',
      'workflow-content',
    )
    const mergeStrategy = await askChoice('How does a branch reach the mainline?', [
      'merge-commit',
      'squash',
    ] as const)
    const outOfScopeFindings = await askChoice(
      'What do agents do with out-of-scope breakage they discover?',
      ['bank', 'autofix'] as const,
    )

    const releaseTarget = await askChoice('What is a release for this project?', [
      'deployed-product',
      'published-package',
    ] as const)
    let release: InstallAnswers['release']
    if (releaseTarget === 'deployed-product') {
      release = { target: 'deployed-product' }
    } else {
      const packages: { name: string; publishCommand: string }[] = []
      do {
        const name = await ask('Published package name?')
        const publishCommand = await ask(
          `Command the user runs locally to publish ${name}?`,
        )
        packages.push({ name, publishCommand })
      } while (await askYesNo('Another published package?'))
      release = { target: 'published-package', packages }
    }

    const gates: InstallAnswers['gates'] = { full: [] }
    const lint = await ask('Lint command? (- for none)', '-')
    if (lint !== '-') gates.lint = lint
    const typecheck = await ask('Typecheck command? (- for none)', '-')
    if (typecheck !== '-') gates.typecheck = typecheck
    const unit = await ask('Unit-test command? (- for none)', '-')
    if (unit !== '-') gates.unit = unit
    const relatedSpecs = await ask('Related-specs command? (- for none)', '-')
    if (relatedSpecs !== '-') gates.relatedSpecs = relatedSpecs
    do {
      gates.full.push(await ask('Full-gate command the orchestrator owns?'))
    } while (await askYesNo('Another full-gate command?'))

    const calibrationFile = await ask(
      'Path for the committed subagent-calibration file?',
      `${contentDir}/calibrations.md`,
    )

    const answers: InstallAnswers = {
      projectName,
      contentDir,
      mergeStrategy,
      outOfScopeFindings,
      release,
      gates,
      calibrationFile,
    }

    if (await askYesNo('Does this project have a user-facing web surface?')) {
      answers.webSurface = {
        coverageRegister: await ask(
          'Path for the coverage register?',
          `${contentDir}/${REGISTER_CONTENT_NAMES.coverageRegister}.md`,
        ),
        excusedSurfaces: await ask(
          'Path for the excused-surfaces list?',
          `${contentDir}/${REGISTER_CONTENT_NAMES.excusedSurfaces}.md`,
        ),
      }
    }
    if (await askYesNo('Switch the demo-seed criterion on?')) {
      answers.demoSeed = {
        seedManifest: await ask(
          'Path for the committed seed manifest?',
          `${contentDir}/${REGISTER_CONTENT_NAMES.seedManifest}.md`,
        ),
      }
    }
    if (
      await askYesNo(
        'Does this project expose a machine surface (MCP server, public API)?',
      )
    ) {
      answers.machineSurface = {
        parityStandard: await ask(
          'Path for the capability-parity standard?',
          `${contentDir}/${REGISTER_CONTENT_NAMES.parityStandard}.md`,
        ),
        exceptionRegister: await ask(
          'Path for the exception register?',
          `${contentDir}/${REGISTER_CONTENT_NAMES.exceptionRegister}.md`,
        ),
      }
    }
    if (await askYesNo('Enable the stack layer (react-router-kysely)?')) {
      answers.stack = {
        databaseMutability: await askChoice('Database mutability stance?', [
          'append-only',
          'mutable-when-not-derivable',
        ] as const),
        keyTypes: await ask(
          "Key types: name the project's central context and database types (seeds the type-safety skill's required section).",
        ),
        applicationRoot: await ask(
          "Application root folder (seeds the framework-folder skill's required section)?",
          'app',
        ),
        timeZoneModel: await ask(
          "Time-zone model: one sentence on how this project decides display time zones (seeds the formatting-datetimes skill's required section).",
        ),
      }
    }
    if (!options.corpusNeedsBuilding) return { answers }
    const bookPath = await ask(
      "Path to your own compiled copy of Demand-Side Sales 101, for the shaping corpus? (empty answer: the workflow's distilled account stands in)",
      '',
    )
    return bookPath ? { answers, bookPath } : { answers }
  } finally {
    rl.close()
  }
}
