import { basename } from 'node:path'
import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import type { InstallAnswers } from './install.js'

/**
 * The install interview. An option the rulings give a default is stated in
 * the scaffold without a question; an option with no ruled default is a
 * declaration the install asks for — nothing defaults silently. The stack
 * skills' required declarations (key types, application root, time-zone
 * model) are asked here too, so the first sync never fails on an empty
 * required section.
 */
export async function collectAnswers(
  projectRoot: string,
  streams: { input?: Readable; output?: Writable } = {},
): Promise<InstallAnswers> {
  const rl = createInterface({
    input: streams.input ?? process.stdin,
    output: streams.output ?? process.stdout,
  })
  const ask = async (question: string, fallback?: string): Promise<string> => {
    const suffix = fallback === undefined ? '' : ` [${fallback}]`
    const answer = (await rl.question(`${question}${suffix} `)).trim()
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
    ;(streams.output ?? process.stdout).write(
      `Answer must be one of: ${choices.join(', ')}\n`,
    )
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
          `${contentDir}/coverage-register.md`,
        ),
        excusedSurfaces: await ask(
          'Path for the excused-surfaces list?',
          `${contentDir}/excused-surfaces.md`,
        ),
      }
    }
    if (await askYesNo('Switch the demo-seed criterion on?')) {
      answers.demoSeed = {
        seedManifest: await ask(
          'Path for the committed seed manifest?',
          `${contentDir}/seed-manifest.md`,
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
          `${contentDir}/parity-standard.md`,
        ),
        exceptionRegister: await ask(
          'Path for the exception register?',
          `${contentDir}/exception-register.md`,
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
    return answers
  } finally {
    rl.close()
  }
}
