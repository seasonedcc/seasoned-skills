import type { PackageReleaseFacts } from '../../config/types.js'
import { fillTokens, fragment } from '../fragments.js'
import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The release skill carries the workflow's one release-target option: what a
 * release *is* differs durably by what the project ships. The shared fragment
 * holds the spine — study the span deeply, trace every sentence, treat the
 * publish as the deliberate final act — and the mode fragment picked by
 * `config.release.target` fills the `{{release-mode}}` token. In package mode
 * the project facts (package names, tag prefixes, publish commands) are
 * injected from the configuration like every other fact.
 */
export function composeRelease(context: GenerationContext): GeneratedFile[] {
  const release = context.config.release
  const mode =
    release.target === 'deployed-product'
      ? fragment('skills/release/deployed-product.md')
      : fillTokens(fragment('skills/release/published-package.md'), {
          packages: renderPackageList(release.packages),
        })
  return [composeSkill('release', context, { tokens: { 'release-mode': mode } })]
}

/** One markdown bullet per package: name, release-tag shape, publish command. */
function renderPackageList(packages: PackageReleaseFacts[]): string {
  return packages
    .map((pkg) => {
      const tagPrefix = pkg.tagPrefix ?? 'v'
      return `- \`${pkg.name}\` — release tags \`${tagPrefix}<version>\` (tag prefix \`${tagPrefix}\`); the user publishes with \`${pkg.publishCommand}\``
    })
    .join('\n')
}
