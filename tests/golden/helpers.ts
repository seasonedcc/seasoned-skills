import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../src/config/load.js'
import { loadProjectContent } from '../../src/generation/content.js'
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
  return { config, content: loadProjectContent(root, config.contentDir) }
}
