import { describe, expect, it } from 'vitest'
import { composeSkills } from '../../src/generation/skills/index.js'
import { FIXTURES, loadFixture } from './helpers.js'

describe('generated practice skills', () => {
  for (const fixture of FIXTURES) {
    it(`match the ${fixture} snapshots`, async () => {
      const context = await loadFixture(fixture)
      for (const file of composeSkills(context)) {
        await expect(file.contents).toMatchFileSnapshot(
          `__output__/${fixture}/${file.path}`,
        )
      }
    })
  }
})
