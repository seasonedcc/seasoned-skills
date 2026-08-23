import { DOCTRINE_RESERVED_SECTIONS, renderDefinitionOfDone } from './dod.js'
import { fillTokens, fragment, joinBlocks } from './fragments.js'
import { extractSections } from './sections.js'
import type { GeneratedFile, GenerationContext } from './types.js'

/**
 * The doctrine layer: the standing instruction file every working session
 * reads first. The project's own content leads — its identity, commands,
 * contracts, and domain facts, in its own order — and the workflow's generic
 * doctrine follows, with the options and criterion subjects deciding which
 * blocks weave in.
 */
export function composeDoctrine(context: GenerationContext): GeneratedFile {
  const { config, content } = context
  const doctrineFile = content.files.get('doctrine')
  if (!doctrineFile) throw new Error('doctrine content file is missing')
  const { leading, reserved } = extractSections(
    doctrineFile.body,
    DOCTRINE_RESERVED_SECTIONS,
  )
  const web = config.webSurface !== undefined

  const contracts = reserved.get('Compatibility contracts')
  const codingStyle = fillTokens(fragment('doctrine/coding-style.md'), {
    'backwards-compat-contracts': contracts
      ? ` — but the project carries real compatibility contracts that make it genuinely necessary at times: ${collapse(
          contracts,
        )}`
      : '.',
  })

  const warnings = reserved.get('Additional warnings')

  const contents = joinBlocks(
    `# ${config.projectName}`,
    leading,
    fragment('doctrine/tooling.md'),
    codingStyle,
    fragment('doctrine/fixing-bugs.md'),
    web
      ? fragment('doctrine/quality-bar-web.md')
      : fragment('doctrine/quality-bar-no-web.md'),
    fragment('doctrine/checkouts-worktrees.md'),
    web && fragment('doctrine/browser-verification.md'),
    fragment('doctrine/orchestration.md'),
    fragment('doctrine/talking-with-user.md'),
    config.agentMergesDuringGoal === true
      ? fragment('doctrine/goals-merges-on.md')
      : fragment('doctrine/goals-merges-off.md'),
    fragment('doctrine/goals-common.md'),
    renderDefinitionOfDone(context),
    warnings && `## Additional warnings\n\n${warnings}`,
  )

  return { path: 'CLAUDE.md', contents }
}

function collapse(text: string): string {
  return text.replaceAll(/\s*\n\s*/g, ' ').trim()
}
