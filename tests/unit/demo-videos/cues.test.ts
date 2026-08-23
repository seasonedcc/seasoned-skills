import { describe, expect, it } from 'vitest'
import {
  CueNotFoundError,
  findCue,
  progressAt,
  scheduleMoves,
} from '../../../runtime/demo-videos/rig/cues.js'
import type { Move } from '../../../runtime/demo-videos/rig/screenplay.js'

describe('findCue', () => {
  it('finds a cue that the screenplay wrapped across lines', () => {
    const narration = 'Here is the recipe\n  list inside Acme Foods.'

    expect(findCue(narration, 'the recipe list')).toBe(8)
  })

  it('ignores case and repeated whitespace on both sides', () => {
    expect(findCue('Watch  the cursor.', 'WATCH THE cursor')).toBe(0)
  })

  it('reports a cue that is not in the narration', () => {
    expect(findCue('Watch the cursor.', 'watch the mouse')).toBe(-1)
  })
})

describe('progressAt', () => {
  it('measures how far in by what is actually spoken', () => {
    // Twelve spoken characters before the comma, twelve after.
    expect(progressAt('abcdef ghijkl, mnopqr stuvwx', 14)).toBeCloseTo(0.5, 5)
  })

  it('is zero at the top and one at the end', () => {
    const narration = 'Search narrows the list.'

    expect(progressAt(narration, 0)).toBe(0)
    expect(progressAt(narration, narration.length)).toBe(1)
  })

  it('does not divide by an empty narration', () => {
    expect(progressAt('   ', 2)).toBe(0)
  })
})

describe('scheduleMoves', () => {
  const narration = 'One two three four five six seven eight.'

  it('places a cue where the narrator reaches it', () => {
    const moves: Move[] = [{ do: 'hold', seconds: 1, cue: 'five' }]

    const [scheduled] = scheduleMoves('scene-01', narration, 20, moves)

    // "One two three four" is 15 spoken characters of the narration's 32.
    expect(scheduled?.startsAt).toBeCloseTo((15 / 32) * 20, 3)
  })

  it('lets a hard offset win over anything the words say', () => {
    const moves: Move[] = [{ do: 'hold', seconds: 1, atSecond: 4.5, cue: 'five' }]

    expect(scheduleMoves('scene-01', narration, 20, moves)[0]?.startsAt).toBe(4.5)
  })

  it('leaves a move with no sync hint to follow the one before it', () => {
    const moves: Move[] = [{ do: 'hold', seconds: 1 }]

    expect(scheduleMoves('scene-01', narration, 20, moves)[0]?.startsAt).toBeNull()
  })

  it('refuses a cue the narrator never says', () => {
    const moves: Move[] = [{ do: 'hold', seconds: 1, cue: 'nine' }]

    expect(() => scheduleMoves('scene-01', narration, 20, moves)).toThrow(
      CueNotFoundError,
    )
  })
})
