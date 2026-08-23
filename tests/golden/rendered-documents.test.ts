import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { materializeRuntime } from '../../src/generation/runtime.js'

/**
 * The append-only compatibility contract: committed documents outlive package
 * versions, so an upgrade must keep every previously committed page rendering
 * correctly. These fixtures are frozen pages from the day they were written —
 * never updated to track asset changes — and every class they use and every
 * asset they load must still resolve against the CURRENT generated assets.
 * A failure here means an upgrade broke a page some project has committed.
 */
const fixtures = fileURLToPath(new URL('fixtures/rendered-documents/', import.meta.url))
const runtime = fileURLToPath(new URL('../../runtime/', import.meta.url))

function classTokens(html: string): string[] {
  const tokens = new Set<string>()
  for (const match of html.matchAll(/class="([^"]+)"/g)) {
    for (const token of (match[1] as string).split(/\s+/)) if (token) tokens.add(token)
  }
  return [...tokens].sort()
}

describe('a frozen shaping document against the current assets', () => {
  const html = readFileSync(`${fixtures}shaping-document.html`, 'utf8')

  it('finds every asset it links among the generated shaping assets', () => {
    const generated = new Set(materializeRuntime().map((file) => file.path))
    const links = [...html.matchAll(/(?:href|src)="\.\.\/assets\/([^"]+)"/g)].map(
      (match) => match[1] as string,
    )
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(generated, `document links ../assets/${link}`).toContain(
        `shaping/assets/${link}`,
      )
    }
  })

  it('finds every class it uses in the current stylesheet or document script', () => {
    const vocabulary =
      readFileSync(`${runtime}shaping-assets/document.css`, 'utf8') +
      readFileSync(`${runtime}shaping-assets/drawing/drawing.css`, 'utf8') +
      readFileSync(`${runtime}shaping-assets/document.js`, 'utf8') +
      readFileSync(`${runtime}shaping-assets/drawing/shaping-drawing.js`, 'utf8')
    const missing = classTokens(html).filter(
      (token) => !vocabulary.includes(`.${token}`) && !vocabulary.includes(token),
    )
    expect(missing).toEqual([])
  })
})

describe('a frozen meeting page against the current stylesheet', () => {
  const html = readFileSync(`${fixtures}meeting-page.html`, 'utf8')

  it('loads the stylesheet the package generates into the data folder', () => {
    expect(html).toContain('href="../assets/style.css"')
    const generated = materializeRuntime().map((file) => file.path)
    expect(generated).toContain('requests-from-meetings/assets/style.css')
  })

  it('finds every class it uses defined in the current stylesheet', () => {
    const stylesheet = readFileSync(`${runtime}requests/style.css`, 'utf8')
    const missing = classTokens(html).filter((token) => !stylesheet.includes(`.${token}`))
    expect(missing).toEqual([])
  })
})
