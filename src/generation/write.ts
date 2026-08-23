import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GeneratedFile } from './types.js'

/** Materializes generated files under the project root. */
export function writeGeneratedFiles(projectRoot: string, files: GeneratedFile[]): void {
  for (const file of files) {
    const target = join(projectRoot, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.contents)
    if (file.executable) chmodSync(target, 0o755)
  }
}
