import { describe, expect, it } from 'vitest'
import type { SeasonedSkillsConfig } from './types.js'
import { validateConfig } from './validate.js'

const minimal: SeasonedSkillsConfig = {
  projectName: 'example',
  contentDir: 'workflow-content',
  mergeStrategy: 'merge-commit',
  release: {
    target: 'published-package',
    packages: [{ name: 'example', publishCommand: 'pnpm publish' }],
  },
  gates: {},
  calibrationFile: 'workflow-content/calibrations.md',
}

describe('validateConfig', () => {
  it('accepts a minimal valid configuration', () => {
    expect(validateConfig(minimal)).toEqual([])
  })

  it('rejects a non-object', () => {
    expect(validateConfig('nope')).toEqual(['the configuration must export an object'])
  })

  it('collects every issue at once', () => {
    const issues = validateConfig({})
    expect(issues).toContain('projectName must be a non-empty string')
    expect(issues).toContain('contentDir must be a non-empty string')
    expect(issues).toContain("mergeStrategy must be 'merge-commit' or 'squash'")
    expect(issues).toContain('release must be declared')
    expect(issues).toContain('gates must be declared')
    expect(issues).toContain('calibrationFile must be a non-empty string')
  })

  it('rejects a published-package release with no packages', () => {
    const issues = validateConfig({
      ...minimal,
      release: { target: 'published-package', packages: [] },
    })
    expect(issues).toEqual(['release.packages must list at least one package'])
  })

  it('rejects an unknown stack', () => {
    const issues = validateConfig({
      ...minimal,
      stack: { name: 'rails', databaseMutability: 'append-only' },
    })
    expect(issues).toEqual(["stack.name must be 'react-router-kysely'"])
  })

  it('rejects a partial web surface declaration', () => {
    const issues = validateConfig({
      ...minimal,
      webSurface: { coverageRegister: 'registers/coverage.md' },
    })
    expect(issues).toEqual(['webSurface.excusedSurfaces must be a non-empty string'])
  })

  it('requires quickText when a criterion reduces in quick mode', () => {
    const issues = validateConfig({
      ...minimal,
      additionalCriteria: [
        {
          text: 'a task is not done if …',
          backedBy: 'gate',
          quickDisposition: 'reduced',
        },
      ],
    })
    expect(issues).toEqual([
      "additionalCriteria[0].quickText is required when the disposition is 'reduced'",
    ])
  })
})
