#!/usr/bin/env node
/**
 * Prove the drawing library's seed contract: build every demo scene twice in a
 * fresh state and byte-compare the serialised SVG.
 *
 *   node scripts/check_drawing_determinism.mjs
 *
 * Exit codes: 0 every scene matched, 1 a scene drifted, 2 the library is not
 * set up to be checked.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInThisContext } from 'node:vm'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const drawingDirectory = join(repositoryRoot, 'skill', 'shaping', 'assets', 'drawing')

function load(name) {
  try {
    return readFileSync(join(drawingDirectory, name), 'utf8')
  } catch (error) {
    console.error(`ERROR: cannot read ${join('skill', 'shaping', 'assets', 'drawing', name)}: ${error.message}`)
    process.exit(2)
  }
}

const librarySource = load('shaping-drawing.js')
const demoSource = load('demo.js')

function buildAll() {
  // Re-evaluate both files from source each pass, so nothing a scene did last
  // time can be carrying over into this one.
  delete globalThis.ShapingDrawing
  delete globalThis.ShapingDemo
  runInThisContext(librarySource, { filename: 'shaping-drawing.js' })
  runInThisContext(demoSource, { filename: 'demo.js' })
  return globalThis.ShapingDemo.scenes.map((scene) => ({
    id: scene.id,
    markup: scene.build().toHTML()
  }))
}

function digest(markup) {
  return createHash('sha256').update(markup).digest('hex').slice(0, 16)
}

const first = buildAll()
const second = buildAll()

if (first.length === 0) {
  console.error('ERROR: demo.js exposes no scenes')
  process.exit(2)
}

let failed = 0
console.log(`Rendering ${first.length} demo scenes twice with the same seeds.\n`)
for (let index = 0; index < first.length; index++) {
  const before = first[index]
  const after = second[index]
  const identical = before.markup === after.markup && before.id === after.id
  const status = identical ? 'identical' : 'DRIFTED '
  console.log(
    `  ${status}  ${before.id.padEnd(14)} ${String(before.markup.length).padStart(7)} bytes  sha256:${digest(before.markup)}`
  )
  if (!identical) {
    failed++
    for (let position = 0; position < Math.max(before.markup.length, after.markup.length); position++) {
      if (before.markup[position] !== after.markup[position]) {
        console.error(`    first difference at byte ${position}:`)
        console.error(`      pass 1: ${JSON.stringify(before.markup.slice(position - 40, position + 40))}`)
        console.error(`      pass 2: ${JSON.stringify(after.markup.slice(position - 40, position + 40))}`)
        break
      }
    }
  }
}

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed} of ${first.length} scenes are not deterministic`)
  process.exit(1)
}
console.log(`determinism: clean — all ${first.length} scenes are byte-identical across two renders`)
