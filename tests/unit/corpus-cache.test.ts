import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  corpusBuiltBy,
  corpusCacheRoot,
  corpusReferencesDir,
  materializeCorpus,
} from '../../src/corpus/cache.js'

describe('corpusCacheRoot', () => {
  const original = process.env.XDG_CACHE_HOME

  afterEach(() => {
    if (original === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = original
  })

  it('honors XDG_CACHE_HOME', () => {
    process.env.XDG_CACHE_HOME = '/somewhere/cache'
    expect(corpusCacheRoot()).toBe('/somewhere/cache/seasoned-skills/corpus')
  })

  it('falls back to ~/.cache when XDG_CACHE_HOME is unset or empty', () => {
    process.env.XDG_CACHE_HOME = ''
    expect(corpusCacheRoot()).toContain('.cache/seasoned-skills/corpus')
    expect(corpusCacheRoot()).not.toContain('//')
  })
})

describe('the corpus cache', () => {
  let cache: string

  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'seasoned-skills-corpus-'))
  })

  afterEach(() => {
    rmSync(cache, { recursive: true, force: true })
  })

  it('reports no builder for an absent or malformed marker', () => {
    expect(corpusBuiltBy(cache)).toBeUndefined()
    writeFileSync(join(cache, 'built-by.json'), 'not json')
    expect(corpusBuiltBy(cache)).toBeUndefined()
    writeFileSync(join(cache, 'built-by.json'), '{"version": 7}')
    expect(corpusBuiltBy(cache)).toBeUndefined()
  })

  it('reads the version that built the cache', () => {
    writeFileSync(join(cache, 'built-by.json'), '{"version": "0.0.1"}')
    expect(corpusBuiltBy(cache)).toBe('0.0.1')
  })

  it('materializes nothing when the cache holds no references', () => {
    expect(materializeCorpus(cache)).toEqual([])
  })

  it('maps every cached reference into the generated shaping skill', () => {
    const references = corpusReferencesDir(cache)
    mkdirSync(join(references, '01-shape-up'), { recursive: true })
    writeFileSync(join(references, 'INDEX.md'), '# Corpus index\n')
    writeFileSync(join(references, '01-shape-up/01-introduction.md'), '# Intro\n')
    const files = materializeCorpus(cache)
    expect(files.map((file) => file.path)).toEqual([
      '.claude/skills/shaping/references/01-shape-up/01-introduction.md',
      '.claude/skills/shaping/references/INDEX.md',
    ])
    expect(Buffer.from(files[1]?.contents ?? '').toString()).toBe('# Corpus index\n')
  })
})
