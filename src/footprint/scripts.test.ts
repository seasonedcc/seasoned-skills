import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureSyncScript } from './scripts.js'

describe('ensureSyncScript', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-scripts-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const manifest = () =>
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }

  it('leaves a project without a package.json alone — creating one is the install', () => {
    ensureSyncScript(root)
    expect(existsSync(join(root, 'package.json'))).toBe(false)
  })

  it('sets prepare when the project has none', () => {
    writeFileSync(join(root, 'package.json'), '{"name":"consumer"}\n')
    ensureSyncScript(root)
    expect(manifest().scripts?.prepare).toBe('seasoned-skills sync')
  })

  it("appends after the project's own prepare steps", () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { prepare: 'husky', build: 'tsc' } }),
    )
    ensureSyncScript(root)
    expect(manifest().scripts).toEqual({
      prepare: 'husky && seasoned-skills sync',
      build: 'tsc',
    })
  })

  it('is idempotent once wired', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { prepare: 'seasoned-skills sync' } }),
    )
    const before = readFileSync(join(root, 'package.json'), 'utf8')
    ensureSyncScript(root)
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before)
  })
})
