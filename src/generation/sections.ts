/**
 * Splits a content file's body into its level-2 sections. A project's content
 * file may carry reserved sections (for the doctrine layer: compatibility
 * contracts, responsive bar additions, additional warnings) that the
 * composition weaves at their own anchors; everything else stays one leading
 * block, in the project's own order.
 */
export function extractSections(
  body: string,
  reservedTitles: string[],
): { leading: string; reserved: Map<string, string> } {
  const reserved = new Map<string, string>()
  const lines = body.split('\n')
  const keptLines: string[] = []
  let currentReserved: string | undefined
  let currentLines: string[] = []

  const flush = () => {
    if (currentReserved !== undefined) {
      reserved.set(currentReserved, currentLines.join('\n').trim())
    }
    currentReserved = undefined
    currentLines = []
  }

  for (const line of lines) {
    const heading = line.match(/^## (.+)$/)
    if (heading?.[1]) {
      flush()
      const title = heading[1].trim()
      if (reservedTitles.includes(title)) {
        currentReserved = title
        continue
      }
    }
    if (currentReserved !== undefined) currentLines.push(line)
    else keptLines.push(line)
  }
  flush()

  return { leading: keptLines.join('\n').trim(), reserved }
}
