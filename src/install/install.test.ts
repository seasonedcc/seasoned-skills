import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateConfig } from '../config/validate.js'
import {
  applyInstall,
  type InstallAnswers,
  planInstall,
  renderConfig,
} from './install.js'

const minimal: InstallAnswers = {
  projectName: 'consumer',
  contentDir: 'workflow-content',
  mergeStrategy: 'merge-commit',
  outOfScopeFindings: 'bank',
  release: {
    target: 'published-package',
    packages: [{ name: 'consumer', publishCommand: 'pnpm release' }],
  },
  gates: { lint: 'pnpm check', unit: 'pnpm test:unit', full: ['pnpm test'] },
  calibrationFile: 'workflow-content/calibrations.md',
}

const full: InstallAnswers = {
  ...minimal,
  release: { target: 'deployed-product' },
  webSurface: {
    coverageRegister: 'workflow-content/coverage-register.md',
    excusedSurfaces: 'workflow-content/excused-surfaces.md',
  },
  demoSeed: { seedManifest: 'workflow-content/seed-manifest.md' },
  machineSurface: {
    parityStandard: 'workflow-content/parity-standard.md',
    exceptionRegister: 'workflow-content/exception-register.md',
  },
  stack: {
    databaseMutability: 'append-only',
    keyTypes: '`AppContext` and the generated `DB` types.',
    applicationRoot: 'app',
    timeZoneModel: 'Everything renders in the venue time zone.',
  },
}

describe('planInstall', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-install-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses a project that is already adopted', () => {
    writeFileSync(join(root, 'seasoned-skills.config.ts'), '')
    expect(() => planInstall(root, minimal)).toThrow(/already exists/)
  })

  it('scaffolds the config, content files, artifacts, and a minimal package.json', () => {
    const plan = planInstall(root, minimal)
    applyInstall(root, plan)
    const paths = plan.files.map((file) => file.path)
    expect(paths).toContain('seasoned-skills.config.ts')
    expect(paths).toContain('workflow-content/doctrine.md')
    expect(paths).toContain('workflow-content/quick.md')
    expect(paths).toContain('workflow-content/calibrations.md')
    expect(paths).toContain('shaping/.gitkeep')
    expect(paths).toContain('requests-from-meetings/assets/manifest.json')
    expect(paths).toContain('requests-from-meetings/stakeholders.md')
    expect(paths).toContain('package.json')
    // No stack layer, so no stack content files and no register stubs.
    expect(paths).not.toContain('workflow-content/kysely.md')
    expect(paths).not.toContain('workflow-content/coverage-register.md')
    expect(readFileSync(join(root, 'workflow-content/quick.md'), 'utf8')).toBe('')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(manifest.scripts.prepare).toBe('seasoned-skills sync')
  })

  it('seeds the required stack declarations so the first sync cannot fail on them', () => {
    const plan = planInstall(root, full)
    applyInstall(root, plan)
    expect(readFileSync(join(root, 'workflow-content/type-safety.md'), 'utf8')).toContain(
      '## Key types',
    )
    expect(
      readFileSync(join(root, 'workflow-content/framework-folder.md'), 'utf8'),
    ).toContain('## Application root\n\napp')
    expect(
      readFileSync(join(root, 'workflow-content/formatting-datetimes.md'), 'utf8'),
    ).toContain('## Time-zone model')
    expect(existsSync(join(root, 'workflow-content/kysely.md'))).toBe(true)
    expect(existsSync(join(root, 'workflow-content/coverage-register.md'))).toBe(true)
  })

  it('never overwrites what already exists', () => {
    writeFileSync(join(root, 'package.json'), '{"name":"kept"}')
    const plan = planInstall(root, minimal)
    applyInstall(root, plan)
    expect(plan.skipped).toContain('package.json')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{"name":"kept"}')
  })
})

describe('renderConfig', () => {
  it('states every option explicitly and validates as written', async () => {
    for (const answers of [minimal, full]) {
      const source = renderConfig(answers)
      expect(source).toContain('agentMergesDuringGoal: false')
      expect(source).toContain('outOfScopeFindings:')
      expect(source).toContain('additionalCriteria: []')
      expect(source).toContain('quickDisqualifiers: []')
      // Provisioning has no ruled default, so the scaffold states it as a
      // commented example rather than leaving the option silently absent.
      expect(source).toContain('// provisioning: {')
      // The scaffold must be a valid configuration the loader would accept.
      const withoutImport = source
        .replace("import { defineConfig } from 'seasoned-skills'", '')
        .replace('export default defineConfig(', 'return (')
      const config = new Function(withoutImport)()
      expect(validateConfig(config)).toEqual([])
    }
  })
})
