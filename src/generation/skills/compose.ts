import { fillTokens, fragment, joinBlocks } from '../fragments.js'
import { extractSections } from '../sections.js'
import type { GeneratedFile, GenerationContext } from '../types.js'

/**
 * The uniform injection contract every generated practice skill follows: the
 * package's fragment supplies the front matter and the generic body, the
 * project's optional content file for the skill supplies the trigger
 * vocabulary woven into the description and the project-specifics section
 * woven in at the anchor, and every skill closes by stating where its lessons
 * go. No content file means the project has nothing to add.
 *
 * A structured slot — a project fact the generic text weaves at its own
 * anchor rather than in the project-specifics section — is declared as a
 * reserved level-2 section of the content file: its text fills the named
 * token, and the rest of the content file weaves as usual. Composition takes
 * an absent slot as nothing to add; whether a content file that exists must
 * carry it is the roster's declaration, checked before the sync composes.
 */
export interface ReservedSectionSpec {
  title: string
  token: string
  /** The sync fails when a content file exists without this section. */
  required?: boolean
}

export interface ComposeSkillOptions {
  tokens?: Record<string, string>
  reservedSections?: ReservedSectionSpec[]
}

export function composeSkill(
  skillName: string,
  context: GenerationContext,
  options: ComposeSkillOptions = {},
): GeneratedFile {
  const parsed = parseSkillFragment(fragment(`skills/${skillName}/SKILL.md`), skillName)
  const content = context.content.files.get(skillName) ?? { body: '' }

  const description = content.triggers
    ? `${parsed.description} ${content.triggers}`
    : parsed.description
  const frontMatter = [
    '---',
    `name: ${skillName}`,
    `description: ${description}`,
    ...parsed.extraHeaderLines,
    '---',
  ].join('\n')

  const tokens = { ...options.tokens }
  let projectBody = content.body
  if (options.reservedSections && options.reservedSections.length > 0) {
    const { leading, reserved } = extractSections(
      content.body,
      options.reservedSections.map((spec) => spec.title),
    )
    for (const spec of options.reservedSections) {
      tokens[spec.token] = reserved.get(spec.title) ?? ''
    }
    projectBody = leading
  }
  const body =
    Object.keys(tokens).length > 0 ? fillTokens(parsed.body, tokens) : parsed.body
  const contentFile = `${context.config.contentDir}/${skillName}.md`

  const contents = joinBlocks(
    frontMatter,
    body,
    projectBody !== '' &&
      `## Project specifics\n\n${fragment('skills/_shared/project-specifics-intro.md').trim()}\n\n${projectBody}`,
    fillTokens(fragment('skills/_shared/lessons.md'), { 'content-file': contentFile }),
  )

  return { path: `.claude/skills/${skillName}/SKILL.md`, contents }
}

interface SkillFragmentParts {
  description: string
  extraHeaderLines: string[]
  body: string
}

export function parseSkillFragment(raw: string, skillName: string): SkillFragmentParts {
  if (!raw.startsWith('---\n')) {
    throw new Error(`skill fragment for ${skillName} has no front matter`)
  }
  const end = raw.indexOf('\n---', 4)
  if (end === -1) throw new Error(`skill fragment for ${skillName} has no front matter`)
  const headerLines = raw.slice(4, end).split('\n')
  const body = raw
    .slice(end + 4)
    .replace(/^\n/, '')
    .trim()

  let description: string | undefined
  const extraHeaderLines: string[] = []
  for (const line of headerLines) {
    const nameMatch = line.match(/^name:\s*(.+)$/)
    if (nameMatch) {
      if (nameMatch[1]?.trim() !== skillName) {
        throw new Error(
          `skill fragment for ${skillName} names itself ${nameMatch[1]?.trim()}`,
        )
      }
      continue
    }
    const descriptionMatch = line.match(/^description:\s*(.+)$/)
    if (descriptionMatch?.[1]) {
      description = descriptionMatch[1].trim()
      continue
    }
    extraHeaderLines.push(line)
  }
  if (description === undefined) {
    throw new Error(`skill fragment for ${skillName} has no description`)
  }
  return { description, extraHeaderLines, body }
}
