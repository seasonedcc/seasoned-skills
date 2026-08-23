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
  it('loads files and reports every missing required name at once', () => {
    const root = mkdtempSync(join(tmpdir(), 'seasoned-skills-content-'))
    mkdirSync(join(root, 'workflow-content'))
    writeFileSync(join(root, 'workflow-content', 'doctrine.md'), 'Facts.\n')
    const { content, missing } = loadProjectContent(root, 'workflow-content', [
      'doctrine',
      'orchestration',
      'testing',
    ])
    expect(content.files.get('doctrine')?.body).toBe('Facts.')
    expect(missing).toEqual(['orchestration', 'testing'])
  })

  it('reports everything missing when the directory does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'seasoned-skills-content-'))
    const { missing } = loadProjectContent(root, 'workflow-content', ['doctrine'])
    expect(missing).toEqual(['doctrine'])
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
