import type { Move } from './screenplay.js'

/** Where a cue falls inside its narration, as a fraction of the way through.
 *
 *  The narration is a single take retimed to one speaking rate, so how far the
 *  narrator has got at any moment tracks how many letters they have already
 *  said far better than how many words: "an" and "reconciliation" are one word
 *  each and nothing like the same length of speech. Whitespace and punctuation
 *  are not spoken, so they do not count. */
function progressAt(narration: string, index: number) {
  const spoken = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').length
  const total = spoken(narration)
  if (total === 0) return 0
  return spoken(narration.slice(0, index)) / total
}

function normalize(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Finds a cue in its narration, tolerating the line breaks a screenplay wraps
 *  its narration with. Returns the index into the original string. */
function findCue(narration: string, cue: string) {
  const wanted = normalize(cue)
  if (!wanted) return -1

  const flat: string[] = []
  const origins: number[] = []
  let previousWasSpace = true
  for (let index = 0; index < narration.length; index += 1) {
    const character = narration[index]
    if (character === undefined) continue
    if (/\s/.test(character)) {
      if (previousWasSpace) continue
      flat.push(' ')
      origins.push(index)
      previousWasSpace = true
      continue
    }
    flat.push(character.toLowerCase())
    origins.push(index)
    previousWasSpace = false
  }

  const found = flat.join('').indexOf(wanted)
  return found < 0 ? -1 : (origins[found] ?? -1)
}

export class CueNotFoundError extends Error {
  constructor(sceneId: string, cue: string) {
    super(
      `[${sceneId}] the cue "${cue}" is not in this scene's narration. A cue is a verbatim fragment of what the narrator says.`
    )
  }
}

export type ScheduledMove = { move: Move; startsAt: number | null }

/** Turns each move's sync hint into the second of the scene it should start on.
 *  A move with neither a cue nor an offset follows whatever came before it, so
 *  it gets no start time and the performer simply carries on. */
export function scheduleMoves(
  sceneId: string,
  narration: string,
  narrationSeconds: number,
  moves: Move[]
): ScheduledMove[] {
  return moves.map((move) => {
    if (move.atSecond !== undefined) {
      return { move, startsAt: move.atSecond }
    }
    if (move.cue === undefined) return { move, startsAt: null }

    const index = findCue(narration, move.cue)
    if (index < 0) throw new CueNotFoundError(sceneId, move.cue)
    return {
      move,
      startsAt: progressAt(narration, index) * narrationSeconds,
    }
  })
}

export { findCue, progressAt }
