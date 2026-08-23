import { describe, expect, it } from 'vitest'
import { defineConfig } from './define.js'
import type { SeasonedSkillsConfig } from './types.js'

describe('defineConfig', () => {
  it('returns the config unchanged', () => {
    const config: SeasonedSkillsConfig = {
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
    expect(defineConfig(config)).toBe(config)
  })
})
