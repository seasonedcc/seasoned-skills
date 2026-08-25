import { describe, expect, it } from 'vitest'
import type { SeasonedSkillsConfig } from '../../config/types.js'
import type { ContentFile, GenerationContext } from '../types.js'
import { composeSkill, parseSkillFragment } from './compose.js'

function makeContext(content: ContentFile | undefined): GenerationContext {
  const config: SeasonedSkillsConfig = {
    projectName: 'Example',
    contentDir: 'workflow-content',
    mergeStrategy: 'merge-commit',
    release: { target: 'deployed-product' },
    gates: {},
    calibrationFile: 'workflow-content/calibrations.md',
  }
  const files = new Map<string, ContentFile>()
  if (content) files.set('skill-management', content)
  return { config, content: { files } }
}

describe('composeSkill', () => {
  it('weaves the project triggers into the description', () => {
    const context = makeContext({ triggers: 'Also use when wiring helpers.', body: '' })
    const { contents } = composeSkill('skill-management', context)
    expect(contents).toContain('troubleshooting. Also use when wiring helpers.\n---')
  })

  it('weaves the project body in as a project-specifics section', () => {
    const context = makeContext({ body: 'Skills live only at the project level.' })
    const { contents, path } = composeSkill('skill-management', context)
    expect(path).toBe('.claude/skills/skill-management/SKILL.md')
    expect(contents).toContain('## Project specifics\n\nThis section carries the')
    expect(contents).toContain('Skills live only at the project level.')
    expect(contents).toContain(
      'lessons about this skill land in `workflow-content/skill-management.md`',
    )
  })

  it('omits the project-specifics section when the content file is empty', () => {
    const { contents } = composeSkill('skill-management', makeContext({ body: '' }))
    expect(contents).not.toContain('## Project specifics')
    expect(contents).toContain('## Where lessons go')
  })

  it('composes without a content file — the project has nothing to add', () => {
    const { contents } = composeSkill('skill-management', makeContext(undefined))
    expect(contents).not.toContain('## Project specifics')
    expect(contents).toContain('## Where lessons go')
  })
})

describe('composeSkill reserved sections', () => {
  const body = [
    'General notes.',
    '',
    '## Progressive disclosure facts',
    '',
    'Level facts here.',
  ].join('\n')

  it('extracts a reserved section out of the specifics into its token', () => {
    // The exemplar fragment carries no marker for the token, so the extracted
    // text goes unused; what the test observes is the extraction itself — the
    // reserved section leaves the project-specifics weave.
    const context = makeContext({ body })
    const { contents } = composeSkill('skill-management', context, {
      reservedSections: [{ title: 'Progressive disclosure facts', token: 'facts' }],
    })
    expect(contents).toContain('## Project specifics')
    expect(contents).toContain('General notes.')
    expect(contents).not.toContain('Level facts here.')
  })

  it('throws when a required reserved section is absent', () => {
    const context = makeContext({ body })
    expect(() =>
      composeSkill('skill-management', context, {
        reservedSections: [{ title: 'Time-zone model', token: 'tz', required: true }],
      }),
    ).toThrow('missing its required "Time-zone model" section')
  })
})

describe('parseSkillFragment', () => {
  const raw = [
    '---',
    'name: sample',
    'description: Does a thing. Use when asked.',
    'allowed-tools: Read, Grep',
    '---',
    '',
    '# Sample',
    '',
    'Body text.',
    '',
  ].join('\n')

  it('splits description, extra header lines, and body', () => {
    expect(parseSkillFragment(raw, 'sample')).toEqual({
      description: 'Does a thing. Use when asked.',
      extraHeaderLines: ['allowed-tools: Read, Grep'],
      body: '# Sample\n\nBody text.',
    })
  })

  it('rejects a fragment whose name disagrees with its folder', () => {
    expect(() => parseSkillFragment(raw, 'other')).toThrow(
      'skill fragment for other names itself sample',
    )
  })

  it('rejects a fragment with no front matter or no description', () => {
    expect(() => parseSkillFragment('# Bare\n', 'sample')).toThrow('no front matter')
    expect(() => parseSkillFragment('---\nname: sample\n---\nBody\n', 'sample')).toThrow(
      'no description',
    )
  })
})
