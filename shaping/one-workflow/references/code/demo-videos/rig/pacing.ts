import type { Pacing } from './screenplay'

export type Point = { x: number; y: number }
export type TravelStep = Point & { after: number }

function easeInOutCubic(fraction: number) {
  return fraction < 0.5 ? 4 * fraction ** 3 : 1 - (-2 * fraction + 2) ** 3 / 2
}

/** A deterministic wobble in [-1, 1). The rig never uses Math.random: two runs
 *  of the same screenplay have to produce the same take, or a retake is not a
 *  retake. */
function wobble(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}

/** The positions a cursor is drawn at on its way from one place to another.
 *
 *  Two things separate this from a straight interpolation, and both are why a
 *  recording reads as a person rather than a script: the path bows to one side
 *  instead of running down the shortest line, and it eases — slow to leave,
 *  fast in the middle, slow to arrive. */
export function travelPath(
  from: Point,
  to: Point,
  pacing: Pacing,
  seed: number
): TravelStep[] {
  const { travel } = pacing
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  if (distance < 1) return [{ ...to, after: 0 }]

  const seconds = Math.min(
    Math.max(distance / travel.pixelsPerSecond, travel.shortest),
    travel.longest
  )
  const samples = Math.max(2, travel.samples)
  const side = wobble(seed) >= 0 ? 1 : -1
  const bow = distance * travel.bow * side
  const control = {
    x: (from.x + to.x) / 2 - ((to.y - from.y) / distance) * bow,
    y: (from.y + to.y) / 2 + ((to.x - from.x) / distance) * bow,
  }

  const steps: TravelStep[] = []
  let elapsed = 0
  for (let sample = 1; sample <= samples; sample += 1) {
    const eased = easeInOutCubic(sample / samples)
    const inverse = 1 - eased
    steps.push({
      x:
        inverse ** 2 * from.x +
        2 * inverse * eased * control.x +
        eased ** 2 * to.x,
      y:
        inverse ** 2 * from.y +
        2 * inverse * eased * control.y +
        eased ** 2 * to.y,
      after: 0,
    })
    const at = (seconds * sample) / samples
    steps[steps.length - 1].after = at - elapsed
    elapsed = at
  }
  return steps
}

export type KeyStroke = { character: string; after: number }

/** Typing cadence. Nobody types at a constant rate: keys inside a word come
 *  fast, the hand pauses at a space and pauses longer at punctuation. */
export function typingCadence(text: string, pacing: Pacing): KeyStroke[] {
  const { typing } = pacing
  return Array.from(text).map((character, index) => {
    const jitter = 1 + wobble(index + 1) * typing.jitter
    let after = typing.secondsPerCharacter * jitter
    if (character === ' ') after += typing.afterWord
    if (/[.,;:!?]/.test(character)) after += typing.afterPunctuation
    return { character, after: Math.max(0.02, after) }
  })
}
