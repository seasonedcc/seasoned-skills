import { describe, expect, it } from 'vitest'
import { composeDoctrine } from '../../src/generation/doctrine.js'
import { renderQuickDefinitionOfDone } from '../../src/generation/dod.js'
import { FIXTURES, loadFixture } from './helpers.js'

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
