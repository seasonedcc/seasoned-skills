import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProjectContent, parseContentFile } from './content.js'
import { extractSections } from './sections.js'

describe('parseContentFile', () => {
  it('reads a plain markdown body', () => {
    expect(parseContentFile('Just prose.\n')).toEqual({ body: 'Just prose.' })
  })

  it('reads trigger vocabulary from front matter', () => {
    const parsed = parseContentFile(
      '---\ntriggers: deploy the fleet\n---\n\nBody here.\n',
    )
    expect(parsed).toEqual({ triggers: 'deploy the fleet', body: 'Body here.' })
  })
})

describe('loadProjectContent', () => {
  it('loads the top-level markdown files, leaving subdirectories alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'seasoned-skills-content-'))
    mkdirSync(join(root, 'workflow-content', 'notes'), { recursive: true })
    mkdirSync(join(root, 'workflow-content', 'archive.md'))
    writeFileSync(join(root, 'workflow-content', 'doctrine.md'), 'Facts.\n')
    writeFileSync(join(root, 'workflow-content', 'notes', 'scratch.md'), 'Aside.\n')
    const content = loadProjectContent(root, 'workflow-content')
    expect(content.files.get('doctrine')?.body).toBe('Facts.')
    expect([...content.files.keys()]).toEqual(['doctrine'])
  })

  it('loads nothing when the directory does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'seasoned-skills-content-'))
    expect(loadProjectContent(root, 'workflow-content').files.size).toBe(0)
  })
})

describe('extractSections', () => {
  it('splits reserved sections out of the leading block', () => {
    const body = [
      'Intro line.',
      '',
      '## Essential commands',
      '',
      '`make test`',
      '',
      '## Additional warnings',
      '',
      'Mind the queue names.',
      '',
      '## Compatibility contracts',
      '',
      'The GA API surface.',
    ].join('\n')
    const { leading, reserved } = extractSections(body, [
      'Additional warnings',
      'Compatibility contracts',
    ])
    expect(leading).toContain('Intro line.')
    expect(leading).toContain('## Essential commands')
    expect(leading).not.toContain('Mind the queue names.')
    expect(reserved.get('Additional warnings')).toBe('Mind the queue names.')
    expect(reserved.get('Compatibility contracts')).toBe('The GA API surface.')
  })
})
