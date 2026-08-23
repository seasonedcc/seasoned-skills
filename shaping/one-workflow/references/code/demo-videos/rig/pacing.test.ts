import { describe, expect, it } from 'vitest'
import { travelPath, typingCadence } from './pacing'
import { HUMAN_PACING } from './screenplay'

const from = { x: 100, y: 100 }
const to = { x: 700, y: 400 }

describe('travelPath', () => {
  it('arrives exactly where it was sent', () => {
    const path = travelPath(from, to, HUMAN_PACING, 1)
    const last = path[path.length - 1]

    expect(last.x).toBeCloseTo(to.x, 6)
    expect(last.y).toBeCloseTo(to.y, 6)
  })

  it('takes the distance divided by the speed, inside its own limits', () => {
    const seconds = travelPath(from, to, HUMAN_PACING, 1).reduce(
      (total, step) => total + step.after,
      0
    )
    const distance = Math.hypot(to.x - from.x, to.y - from.y)

    expect(seconds).toBeCloseTo(
      distance / HUMAN_PACING.travel.pixelsPerSecond,
      5
    )
  })

  it('never crosses a screen faster than its floor', () => {
    const seconds = travelPath(
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      HUMAN_PACING,
      1
    ).reduce((total, step) => total + step.after, 0)

    expect(seconds).toBeCloseTo(HUMAN_PACING.travel.shortest, 5)
  })

  it('bows away from the straight line rather than running down it', () => {
    const path = travelPath(from, to, HUMAN_PACING, 1)
    const middle = path[Math.floor(path.length / 2) - 1]
    const straight = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    }

    expect(
      Math.hypot(middle.x - straight.x, middle.y - straight.y)
    ).toBeGreaterThan(10)
  })

  it('eases: it covers less ground in its first tenth than in its middle', () => {
    const path = travelPath(from, to, HUMAN_PACING, 1)
    const step = (index: number) =>
      Math.hypot(
        path[index].x - path[index - 1].x,
        path[index].y - path[index - 1].y
      )

    expect(step(2)).toBeLessThan(step(Math.floor(path.length / 2)))
  })

  it('repeats itself, so a retake is a retake', () => {
    expect(travelPath(from, to, HUMAN_PACING, 3)).toEqual(
      travelPath(from, to, HUMAN_PACING, 3)
    )
  })

  it('does not travel at all when it is already there', () => {
    expect(travelPath(from, { ...from }, HUMAN_PACING, 1)).toEqual([
      { x: from.x, y: from.y, after: 0 },
    ])
  })
})

describe('typingCadence', () => {
  it('types every character exactly once, in order', () => {
    expect(
      typingCadence('Teriyaki', HUMAN_PACING)
        .map((stroke) => stroke.character)
        .join('')
    ).toBe('Teriyaki')
  })

  it('pauses longer at a space than inside a word', () => {
    const strokes = typingCadence('ab cd', HUMAN_PACING)

    expect(strokes[2].character).toBe(' ')
    expect(strokes[2].after).toBeGreaterThan(strokes[1].after)
  })

  it('pauses longer still at a full stop', () => {
    const strokes = typingCadence('a. b', HUMAN_PACING)

    expect(strokes[1].after).toBeGreaterThan(strokes[2].after)
  })

  it('never types faster than a person can', () => {
    for (const stroke of typingCadence('the quick brown fox.', HUMAN_PACING)) {
      expect(stroke.after).toBeGreaterThanOrEqual(0.02)
    }
  })
})
