import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { loadConfig } from '../../src/config/load.js'
import { loadProjectContent } from '../../src/generation/content.js'
import { knownContentNames } from '../../src/generation/skills/index.js'
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
  const content = loadProjectContent(root, config.contentDir)
  // Every file a fixture owns must be one the sync would recognize; a misnamed
  // one loads into nothing and would snapshot as a silently thinner weave.
  const known = new Set(knownContentNames(config))
  expect([...content.files.keys()].filter((file) => !known.has(file))).toEqual([])
  return { config, content }
}
