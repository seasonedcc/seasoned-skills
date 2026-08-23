import { fillTokens, fragment } from './fragments.js'
import { extractSections } from './sections.js'
import type { GenerationContext } from './types.js'

/**
 * The Definition of Done is generated from one composition, the same way a
 * skill is: the package contributes the core criteria, each carrying the
 * project's facts as parameters; the project injects whole criteria of its
 * own; and every criterion declares its quick-mode disposition, so the quick
 * skill's reduced list is derived from this same composition and the two can
 * never drift apart.
 */
export interface Criterion {
  id: string
  text: string
  quick: 'kept' | 'reduced' | 'excluded'
  quickText?: string
}

export const DOCTRINE_RESERVED_SECTIONS = [
  'Compatibility contracts',
  'Responsive bar',
  'Additional warnings',
  'Documentation-only carve-out',
]

export function composeCriteria(context: GenerationContext): Criterion[] {
  const { config } = context
  const doctrineContent = context.content.files.get('doctrine')
  const reserved = extractSections(
    doctrineContent?.body ?? '',
    DOCTRINE_RESERVED_SECTIONS,
  ).reserved
  const criteria: Criterion[] = []
  const web = config.webSurface !== undefined
  const stack = config.stack !== undefined

  const fastGates = [config.gates.lint, config.gates.typecheck, config.gates.unit].filter(
    (gate): gate is string => gate !== undefined,
  )
  if (fastGates.length > 0) {
    criteria.push({
      id: 'gates',
      text: fillTokens(fragment('doctrine/dod/gates.md'), {
        'fast-gates': listCommands(fastGates),
      }),
      quick: 'reduced',
      quickText: `${listCommands(
        fastGates.filter((gate) => gate !== config.gates.unit),
      )} are green. Run only the unit test files the change affects — the full suites run on the PR's CI.`,
    })
  }

  if (web) {
    criteria.push({
      id: 'full-suite-ci',
      text: fillTokens(fragment('doctrine/dod/full-suite-ci.md'), {
        'e2e-filter-footgun': stack
          ? ' (the filter must be a file path or `--grep` — a bare name is silently ignored and the full suite runs)'
          : '',
      }),
      quick: 'kept',
      quickText:
        'Open a PR. The CI E2E job stays the acceptance gate — fix any red on the branch.',
    })
  }

  criteria.push({
    id: 'comments',
    text: fragment('doctrine/dod/comments.md'),
    quick: 'kept',
    quickText:
      'A task is not done if it has leftover comments — remove them before finishing.',
  })

  criteria.push({
    id: 'review-loop',
    text: fragment('doctrine/dod/review-loop.md'),
    quick: 'reduced',
    quickText:
      "One `pr-review` pass over the lane's draft PR, with the fixes applied. A single pass, not a loop.",
  })

  if (web) {
    criteria.push({
      id: 'browser',
      text: fragment('doctrine/dod/browser.md'),
      quick: 'reduced',
      quickText:
        'Verify the changed flow end to end with `agent-browser` and take a screenshot.',
    })
    const responsiveLines = reserved.get('Responsive bar')
    criteria.push({
      id: 'responsive',
      text: fillTokens(fragment('doctrine/dod/responsive.md'), {
        'responsive-project-lines': responsiveLines
          ? ` ${collapse(responsiveLines)}`
          : '',
      }),
      quick: 'excluded',
    })
    criteria.push({
      id: 'coverage',
      text: fillTokens(fragment('doctrine/dod/coverage.md'), {
        'coverage-register': `\`${config.webSurface?.coverageRegister ?? ''}\``,
        'excused-surfaces': `\`${config.webSurface?.excusedSurfaces ?? ''}\``,
      }),
      quick: 'reduced',
      quickText:
        'If user-visible behavior changed, update the existing spec that covers the flow — a brand-new spec still follows the `testing` skill in full.',
    })
  }

  if (config.demoSeed) {
    criteria.push({
      id: 'demo-seed',
      text: fillTokens(fragment('doctrine/dod/demo-seed.md'), {
        'seed-manifest': `\`${config.demoSeed.seedManifest}\``,
        'seed-denominator': stack
          ? "The denominator of surfaces is derived from the stack's own route enumeration, never maintained by hand — a surface nobody covered fails the gate outright instead of depending on review-time honesty."
          : "The stack cannot derive the denominator of surfaces from its route enumeration, so adding the entry is this criterion's review-time requirement — honestly, the weaker gate.",
      }),
      quick: 'excluded',
    })
  }

  if (config.machineSurface) {
    criteria.push({
      id: 'machine-parity',
      text: fillTokens(fragment('doctrine/dod/machine-parity.md'), {
        'parity-standard': `\`${config.machineSurface.parityStandard}\``,
        'exception-register': `\`${config.machineSurface.exceptionRegister}\``,
      }),
      quick: 'excluded',
    })
  }

  for (const injected of config.additionalCriteria ?? []) {
    criteria.push({
      id: `injected:${injected.backedBy}`,
      text: `${injected.text} (backed by ${injected.backedBy}.)`,
      quick: injected.quickDisposition,
      ...(injected.quickText !== undefined && { quickText: injected.quickText }),
    })
  }

  criteria.push({
    id: 'self-improvement',
    text: fragment('doctrine/dod/self-improvement.md'),
    quick: 'excluded',
  })

  return criteria
}

/** The full Definition of Done section for the generated doctrine. */
export function renderDefinitionOfDone(context: GenerationContext): string {
  const doctrineContent = context.content.files.get('doctrine')
  const reserved = extractSections(
    doctrineContent?.body ?? '',
    DOCTRINE_RESERVED_SECTIONS,
  ).reserved
  const carveOutFacts = reserved.get('Documentation-only carve-out')
  const intro = fillTokens(fragment('doctrine/dod/intro.md'), {
    'docs-only-project-facts': carveOutFacts ? ` ${collapse(carveOutFacts)}` : '',
  })
  const bullets = composeCriteria(context)
    .map((criterion) => `- ${criterion.text}`)
    .join('\n')
  return `${intro}\n\n${bullets}`
}

/** The reduced list the quick skill renders, derived from the same composition. */
export function renderQuickDefinitionOfDone(context: GenerationContext): string {
  const items = composeCriteria(context)
    .filter((criterion) => criterion.quick !== 'excluded')
    .map((criterion, index) => `${index + 1}. ${criterion.quickText ?? criterion.text}`)
  return items.join('\n')
}

function listCommands(commands: string[]): string {
  const wrapped = commands.map((command) => `\`${command}\``)
  if (wrapped.length === 1) return wrapped[0] as string
  if (wrapped.length === 2) return `${wrapped[0]} and ${wrapped[1]}`
  return `${wrapped.slice(0, -1).join(', ')}, and ${wrapped.at(-1)}`
}

function collapse(text: string): string {
  return text.replaceAll(/\s*\n\s*/g, ' ').trim()
}
