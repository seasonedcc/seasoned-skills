import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG_FILE_NAME, ConfigError, loadConfig } from './load.js'

function scratchProject(): string {
  return mkdtempSync(join(tmpdir(), 'seasoned-skills-test-'))
}

describe('loadConfig', () => {
  it('loads a TypeScript configuration without a build step', async () => {
    const root = scratchProject()
    writeFileSync(
      join(root, CONFIG_FILE_NAME),
      `
      const config = {
        projectName: 'example' as const,
        contentDir: 'workflow-content',
        mergeStrategy: 'merge-commit' as const,
        release: {
          target: 'published-package' as const,
          packages: [{ name: 'example', publishCommand: 'pnpm publish' }],
        },
        gates: {},
        calibrationFile: 'workflow-content/calibrations.md',
      }
      export default config
      `,
    )
    const config = await loadConfig(root)
    expect(config.projectName).toBe('example')
    expect(config.mergeStrategy).toBe('merge-commit')
  })

  it('fails loud when the file is missing', async () => {
    const root = scratchProject()
    await expect(loadConfig(root)).rejects.toThrow(ConfigError)
  })

  it('fails loud when there is no usable default export', async () => {
    const root = scratchProject()
    writeFileSync(join(root, CONFIG_FILE_NAME), 'export const config = {}')
    await expect(loadConfig(root)).rejects.toThrow(ConfigError)
  })

  it('reports every validation issue in the error', async () => {
    const root = scratchProject()
    writeFileSync(join(root, CONFIG_FILE_NAME), 'export default { projectName: "x" }')
    const error = await loadConfig(root).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).issues.length).toBeGreaterThan(1)
  })
})
