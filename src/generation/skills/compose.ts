import { fillTokens, fragment, joinBlocks } from '../fragments.js'
import type { GeneratedFile, GenerationContext } from '../types.js'

/**
 * The uniform injection contract every generated practice skill follows: the
 * package's fragment supplies the front matter and the generic body, the
 * project's content file for the skill supplies the trigger vocabulary woven
 * into the description and the project-specifics section woven in at the
 * anchor, and every skill closes by stating where its lessons go.
 */
export interface ComposeSkillOptions {
  tokens?: Record<string, string>
}

export function composeSkill(
  skillName: string,
  context: GenerationContext,
  options: ComposeSkillOptions = {},
): GeneratedFile {
  const parsed = parseSkillFragment(fragment(`skills/${skillName}/SKILL.md`), skillName)
  const content = context.content.files.get(skillName)
  if (!content) throw new Error(`${skillName} content file is missing`)

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

  const body = options.tokens ? fillTokens(parsed.body, options.tokens) : parsed.body
  const contentFile = `${context.config.contentDir}/${skillName}.md`

  const contents = joinBlocks(
    frontMatter,
    body,
    content.body !== '' &&
      `## Project specifics\n\n${fragment('skills/_shared/project-specifics-intro.md').trim()}\n\n${content.body}`,
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
