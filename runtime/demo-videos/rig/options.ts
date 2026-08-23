const VALUED_OPTIONS = ['--scene', '--base-url']
const BARE_OPTIONS = ['--assemble', '--check', '--refresh-narration']

export const usage = `Renders a demo video from its screenplay.

  pnpm run demo:video <slug> <cut>                 the whole cut
  pnpm run demo:video <slug> <cut> --scene <id>    retake one scene, reassemble
  pnpm run demo:video <slug> <cut> --assemble      reassemble what is on disk
  pnpm run demo:video <slug> <cut> --check         listen back to every scene

Options
  --refresh-narration   speak every scene again instead of reusing takes
  --base-url <url>      the running product to film (default: the production's)`

/** A misread option costs a whole render, so every one of them is either known
 *  or refused. */
export function parseArguments(argv: string[]) {
  const positional: string[] = []
  const values = new Map<string, string>()
  const bare = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined) continue
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    if (BARE_OPTIONS.includes(argument)) {
      bare.add(argument)
      continue
    }
    if (!VALUED_OPTIONS.includes(argument)) {
      throw new Error(`Unknown option: ${argument}\n\n${usage}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} needs a value\n\n${usage}`)
    }
    values.set(argument, value)
    index += 1
  }

  const [slug, cut, ...extra] = positional
  if (!slug || !cut) throw new Error(usage)
  if (extra.length > 0) {
    throw new Error(`Unexpected argument(s): ${extra.join(', ')}\n\n${usage}`)
  }

  return {
    slug,
    cut,
    scene: values.get('--scene'),
    assembleOnly: bare.has('--assemble'),
    check: bare.has('--check'),
    refreshNarration: bare.has('--refresh-narration'),
    baseUrl: values.get('--base-url'),
  }
}
