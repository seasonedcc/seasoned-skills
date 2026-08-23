import { describe, expect, it } from 'vitest'
import { defineConfig } from './define.js'

describe('defineConfig', () => {
  it('returns the config unchanged', () => {
    const config = { projectName: 'example' }
    expect(defineConfig(config)).toBe(config)
  })
})
