import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { corpusReferencesDir } from './cache.js'

const require = createRequire(import.meta.url)
const { version } = require('../../package.json') as { version: string }

const runtimeCorpus = fileURLToPath(new URL('../../runtime/corpus/', import.meta.url))
const distilledAccount = fileURLToPath(
  new URL('../../content/corpus/distilled-account/', import.meta.url),
)

export interface CorpusBuildOptions {
  /** Path to the user's own compiled copy of the commercial book (numbered markdown chapters with images). */
  book?: string
  /** Re-download sources that are already present. */
  force?: boolean
}

/**
 * Builds the shaping corpus into the machine cache: the packaged scripts are
 * copied into the cache (they anchor their paths at their own parent's
 * parent, so the cache mirrors the layout they were written for) and run in
 * order — download, parse, vendor or fall back to the distilled account,
 * then verify with the index regenerated to match exactly what was built.
 * The fetch list lives in the committed scripts; the built corpus lives only
 * on this machine.
 */
export function buildCorpus(cacheRoot: string, options: CorpusBuildOptions = {}): void {
  const scripts = join(cacheRoot, 'scripts')
  mkdirSync(scripts, { recursive: true })
  cpSync(runtimeCorpus, scripts, { recursive: true })

  const force = options.force ? ['--force'] : []
  run(scripts, 'download_shapeup.py', force)
  run(scripts, 'download_articles.py', force)
  run(scripts, 'parse_shapeup.py')
  run(scripts, 'parse_articles.py')

  if (options.book) {
    run(scripts, 'vendor_demand_side_sales.py', ['--source', options.book])
  } else {
    const target = join(corpusReferencesDir(cacheRoot), '02-demand-side-sales-101')
    if (existsSync(distilledAccount)) {
      cpSync(distilledAccount, target, { recursive: true })
    } else if (!existsSync(target)) {
      console.warn(
        'No book given and no distilled account is packaged yet — the corpus builds without 02-demand-side-sales-101.',
      )
    }
  }

  run(scripts, 'verify.py', ['--write-index'])
  writeFileSync(
    join(cacheRoot, 'built-by.json'),
    `${JSON.stringify({ version }, null, 2)}\n`,
  )
}

function run(scripts: string, script: string, args: string[] = []): void {
  const result = spawnSync('python3', [join(scripts, script), ...args], {
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${script} exited with status ${result.status}`)
  }
}
