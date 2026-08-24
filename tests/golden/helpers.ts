import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { loadConfig } from '../../src/config/load.js'
import { loadProjectContent } from '../../src/generation/content.js'
import { requiredContentNames } from '../../src/generation/skills/index.js'
import type { GenerationContext } from '../../src/generation/types.js'

export const FIXTURES = [
  'cli-package',
  'service-squash',
  'web-append-only',
  'web-mutable',
]

export async function loadFixture(name: string): Promise<GenerationContext> {
  const root = fileURLToPath(new URL(`fixtures/${name}/`, import.meta.url))
  const config = await loadConfig(root)
  const { content, missing } = loadProjectContent(
    root,
    config.contentDir,
    requiredContentNames(config),
  )
  expect(missing).toEqual([])
  return { config, content }
}
