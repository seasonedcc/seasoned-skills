import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { materializeRuntime } from './runtime.js'
import { writeGeneratedFiles } from './write.js'

describe('materializeRuntime', () => {
  it('maps every runtime asset to its generated path', () => {
    const paths = materializeRuntime().map((file) => file.path)
    expect(paths).toContain('.claude/statusline.sh')
    expect(paths).toContain('.claude/hooks/block-git-stash.sh')
    expect(paths).toContain('.claude/hooks/isolation-guard.sh')
    expect(paths).toContain('.claude/hooks/session-end-sweep.sh')
    expect(paths).toContain('.claude/skills/subagents/scripts/watchdog.py')
    expect(paths).toContain('.claude/skills/requests-from-meetings/scripts/verify.py')
    expect(paths).toContain('requests-from-meetings/assets/style.css')
    expect(paths).toContain('shaping/assets/document.css')
    expect(paths).toContain('shaping/assets/drawing/fonts/OFL.txt')
  })
})

describe('writeGeneratedFiles', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-write-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('writes text and binary files, marking scripts executable', () => {
    writeGeneratedFiles(root, [
      { path: 'a/b/script.sh', contents: '#!/bin/sh\n', executable: true },
      { path: 'a/asset.bin', contents: new Uint8Array([0, 1, 2]) },
    ])
    expect(readFileSync(join(root, 'a/b/script.sh'), 'utf8')).toBe('#!/bin/sh\n')
    expect(statSync(join(root, 'a/b/script.sh')).mode & 0o111).not.toBe(0)
    expect([...readFileSync(join(root, 'a/asset.bin'))]).toEqual([0, 1, 2])
  })
})
