import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_FILE_NAME } from '../config/load.js'
import type { SeasonedSkillsConfig } from '../config/types.js'
import { requiredContentNames } from '../generation/skills/index.js'
import type { GeneratedFile } from '../generation/types.js'
import { writeGeneratedFiles } from '../generation/write.js'

/**
 * Install: the one-time interactive scaffolder. It creates the committed
 * artifacts the workflow reads — the configuration (stating every option
 * explicitly), the content files (empty, except the declarations the install
 * asked for), the calibration file, the registers, the shaping folder, the
 * meeting-requests data folder — and never overwrites anything that already
 * exists: everything committed accretes through the project's own pull
 * requests afterwards. Regeneration is sync's job, run right after.
 */
export interface InstallAnswers {
  projectName: string
  contentDir: string
  mergeStrategy: 'merge-commit' | 'squash'
  outOfScopeFindings: 'bank' | 'autofix'
  release:
    | { target: 'deployed-product' }
    | {
        target: 'published-package'
        packages: { name: string; publishCommand: string }[]
      }
  gates: {
    lint?: string
    typecheck?: string
    unit?: string
    relatedSpecs?: string
    full: string[]
  }
  calibrationFile: string
  webSurface?: { coverageRegister: string; excusedSurfaces: string }
  demoSeed?: { seedManifest: string }
  machineSurface?: { parityStandard: string; exceptionRegister: string }
  stack?: {
    databaseMutability: 'append-only' | 'mutable-when-not-derivable'
    /** Seeds the type-safety content file's required '## Key types' section. */
    keyTypes: string
    /** Seeds the framework-folder content file's required '## Application root' section. */
    applicationRoot: string
    /** Seeds the formatting-datetimes content file's required '## Time-zone model' section. */
    timeZoneModel: string
  }
}

export interface InstallPlan {
  /** Files to create — paths that already exist on disk are never rewritten. */
  files: GeneratedFile[]
  skipped: string[]
}

export function planInstall(projectRoot: string, answers: InstallAnswers): InstallPlan {
  if (existsSync(join(projectRoot, CONFIG_FILE_NAME))) {
    throw new Error(
      `${CONFIG_FILE_NAME} already exists — this project is adopted. Run \`seasoned-skills sync\` instead.`,
    )
  }

  const candidates: GeneratedFile[] = [
    { path: CONFIG_FILE_NAME, contents: renderConfig(answers) },
    ...contentFiles(answers),
    {
      path: answers.calibrationFile,
      contents:
        '# Subagent calibrations\n\nCalibrations are stated relative to the Definition of Done and accrete\nthrough pull requests as sessions learn what this project needs.\n',
    },
    { path: 'shaping/.gitkeep', contents: '' },
    { path: 'requests-from-meetings/assets/manifest.json', contents: '[]\n' },
    {
      path: 'requests-from-meetings/stakeholders.md',
      contents:
        '# Stakeholders\n\nThe people who appear in meetings, one per line, so records attribute\nquotes consistently.\n',
    },
  ]
  // A repository with no root package manifest gains a minimal one, so the
  // prepare-script wiring carries sync there too; an existing one is kept
  // (sync asserts the script entry surgically).
  candidates.push({
    path: 'package.json',
    contents: `${JSON.stringify(
      {
        name: answers.projectName,
        private: true,
        scripts: { prepare: 'seasoned-skills sync' },
      },
      null,
      2,
    )}\n`,
  })
  if (answers.webSurface) {
    candidates.push(
      {
        path: answers.webSurface.coverageRegister,
        contents:
          '# Coverage register\n\nThe shrink-only register of unreached surfaces. Seed it with the\nsurfaces specs do not reach today; once empty it is held empty forever.\n',
      },
      {
        path: answers.webSurface.excusedSurfaces,
        contents:
          '# Excused surfaces\n\nSurfaces a spec genuinely cannot reach — each entry admitted only with\na one-line written rationale.\n',
      },
    )
  }
  if (answers.demoSeed) {
    candidates.push({
      path: answers.demoSeed.seedManifest,
      contents:
        '# Seed manifest\n\nEvery user-facing surface claims its seed section here; the demo-seed\ngate fails a surface nobody claimed.\n',
    })
  }
  if (answers.machineSurface) {
    candidates.push(
      {
        path: answers.machineSurface.parityStandard,
        contents:
          '# Capability-parity standard\n\nWhat the machine surface must keep up with, audited by the review\nskills.\n',
      },
      {
        path: answers.machineSurface.exceptionRegister,
        contents:
          '# Exception register\n\nEvery tool standing outside the wrap-a-business-function rule, with a\none-line rationale each.\n',
      },
    )
  }

  const files: GeneratedFile[] = []
  const skipped: string[] = []
  for (const file of candidates) {
    if (existsSync(join(projectRoot, file.path))) skipped.push(file.path)
    else files.push(file)
  }
  return { files, skipped }
}

export function applyInstall(projectRoot: string, plan: InstallPlan): void {
  writeGeneratedFiles(projectRoot, plan.files)
}

/**
 * The content files, scaffolded empty — project content accretes through the
 * project's own pull requests — except the sections the install asked for:
 * the stack skills' required declarations never default silently.
 */
function contentFiles(answers: InstallAnswers): GeneratedFile[] {
  const config = configShape(answers)
  const seeded: Record<string, string> = {}
  if (answers.stack) {
    seeded['type-safety'] = `## Key types\n\n${answers.stack.keyTypes}\n`
    seeded['framework-folder'] =
      `## Application root\n\n${answers.stack.applicationRoot}\n`
    seeded['formatting-datetimes'] =
      `## Time-zone model\n\n${answers.stack.timeZoneModel}\n`
  }
  return requiredContentNames(config).map((name) => ({
    path: `${answers.contentDir}/${name}.md`,
    contents: seeded[name] ?? '',
  }))
}

/** The configuration the answers describe, used to derive the content roster. */
function configShape(answers: InstallAnswers): SeasonedSkillsConfig {
  const config: SeasonedSkillsConfig = {
    projectName: answers.projectName,
    contentDir: answers.contentDir,
    mergeStrategy: answers.mergeStrategy,
    outOfScopeFindings: answers.outOfScopeFindings,
    release: answers.release,
    gates: answers.gates,
    calibrationFile: answers.calibrationFile,
  }
  if (answers.webSurface) config.webSurface = answers.webSurface
  if (answers.demoSeed) config.demoSeed = answers.demoSeed
  if (answers.machineSurface) config.machineSurface = answers.machineSurface
  if (answers.stack)
    config.stack = {
      name: 'react-router-kysely',
      databaseMutability: answers.stack.databaseMutability,
    }
  return config
}

/**
 * The configuration scaffold states every option explicitly — the ones the
 * install asked for and the ones the rulings default — so reading the file is
 * reading the project's whole declaration.
 */
export function renderConfig(answers: InstallAnswers): string {
  const lines: string[] = [
    "import { defineConfig } from 'seasoned-skills'",
    '',
    'export default defineConfig({',
    `  projectName: ${quote(answers.projectName)},`,
    `  contentDir: ${quote(answers.contentDir)},`,
    `  mergeStrategy: ${quote(answers.mergeStrategy)},`,
    '  // Agents never merge to the base branch during a goal unless the project opts in.',
    '  agentMergesDuringGoal: false,',
    `  outOfScopeFindings: ${quote(answers.outOfScopeFindings)},`,
  ]
  if (answers.release.target === 'deployed-product') {
    lines.push("  release: { target: 'deployed-product' },")
  } else {
    lines.push('  release: {')
    lines.push("    target: 'published-package',")
    lines.push('    packages: [')
    for (const p of answers.release.packages) {
      lines.push(
        `      { name: ${quote(p.name)}, publishCommand: ${quote(p.publishCommand)} },`,
      )
    }
    lines.push('    ],')
    lines.push('  },')
  }
  lines.push('  gates: {')
  if (answers.gates.lint) lines.push(`    lint: ${quote(answers.gates.lint)},`)
  if (answers.gates.typecheck)
    lines.push(`    typecheck: ${quote(answers.gates.typecheck)},`)
  if (answers.gates.unit) lines.push(`    unit: ${quote(answers.gates.unit)},`)
  if (answers.gates.relatedSpecs)
    lines.push(`    relatedSpecs: ${quote(answers.gates.relatedSpecs)},`)
  lines.push(`    full: [${answers.gates.full.map(quote).join(', ')}],`)
  lines.push('  },')
  lines.push(`  calibrationFile: ${quote(answers.calibrationFile)},`)
  if (answers.webSurface) {
    lines.push('  webSurface: {')
    lines.push(`    coverageRegister: ${quote(answers.webSurface.coverageRegister)},`)
    lines.push(`    excusedSurfaces: ${quote(answers.webSurface.excusedSurfaces)},`)
    lines.push('  },')
  }
  if (answers.demoSeed)
    lines.push(`  demoSeed: { seedManifest: ${quote(answers.demoSeed.seedManifest)} },`)
  if (answers.machineSurface) {
    lines.push('  machineSurface: {')
    lines.push(`    parityStandard: ${quote(answers.machineSurface.parityStandard)},`)
    lines.push(
      `    exceptionRegister: ${quote(answers.machineSurface.exceptionRegister)},`,
    )
    lines.push('  },')
  }
  if (answers.stack) {
    lines.push('  stack: {')
    lines.push("    name: 'react-router-kysely',")
    lines.push(`    databaseMutability: ${quote(answers.stack.databaseMutability)},`)
    lines.push('  },')
  }
  lines.push(
    '  // The resource table isolated worktree lanes are provisioned from. Uncomment',
    '  // and describe what a lane owns; without it, a lane is a worktree and nothing else.',
    '  // provisioning: {',
    "  //   databases: [{ name: 'primary', seeded: true }],",
    '  //   portBases: { web: 3000 },',
    "  //   repositories: [{ path: '.', migrateCommand: 'pnpm migrate' }],",
    '  // },',
  )
  lines.push(
    '  // Whole criteria the project injects beyond the core, each backed by its own gate.',
  )
  lines.push('  additionalCriteria: [],')
  lines.push("  // Quick-mode disqualifiers added to the package's base list.")
  lines.push('  quickDisqualifiers: [],')
  lines.push('})')
  lines.push('')
  return lines.join('\n')
}

function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}
