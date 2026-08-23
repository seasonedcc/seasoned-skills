import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config/load.js'
import { loadProjectContent } from '../../src/generation/content.js'
import { composeDoctrine } from '../../src/generation/doctrine.js'
import { renderQuickDefinitionOfDone } from '../../src/generation/dod.js'

const FIXTURES = ['cli-package', 'web-append-only']

async function loadFixture(name: string) {
  const root = fileURLToPath(new URL(`fixtures/${name}/`, import.meta.url))
  const config = await loadConfig(root)
  const { content, missing } = loadProjectContent(root, config.contentDir, ['doctrine'])
  expect(missing).toEqual([])
  return { config, content }
}

describe('generated doctrine', () => {
  for (const fixture of FIXTURES) {
    it(`matches the ${fixture} snapshot`, async () => {
      const context = await loadFixture(fixture)
      const file = composeDoctrine(context)
      expect(file.path).toBe('CLAUDE.md')
      await expect(file.contents).toMatchFileSnapshot(`__output__/${fixture}/CLAUDE.md`)
    })

    it(`derives the ${fixture} quick list from the same composition`, async () => {
      const context = await loadFixture(fixture)
      await expect(renderQuickDefinitionOfDone(context)).toMatchFileSnapshot(
        `__output__/${fixture}/quick-dod.md`,
      )
    })
  }
})
