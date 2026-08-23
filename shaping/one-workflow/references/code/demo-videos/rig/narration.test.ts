import { describe, expect, it } from 'vitest'
import { takeFingerprint } from './narration'
import {
  HUMAN_PACING,
  type Production,
  type Scene,
  defineProduction,
} from './screenplay'

const production = defineProduction({
  productCommit: 'c77eff7b',
  baseUrl: 'http://localhost:7258',
  resolution: { width: 1280, height: 720 },
  fps: 30,
  narration: {
    engine: 'chatterbox',
    model: 'mlx-community/chatterbox-multilingual-v3',
    voice: 'voices/emily.wav',
    seed: 20260817,
  },
  video: { crf: 20, preset: 'medium', audioBitrate: '192k' },
  pacing: HUMAN_PACING,
})

const scene: Scene = {
  id: 'scene-01-list',
  beat: 'Land on a real screen of the real product.',
  narration: 'Here is the recipe list inside Avatar Foods.',
  needs: [],
  open: { path: '/app/production/recipes' },
  choreography: [],
}

const fingerprint = (
  overrides: Partial<Scene> = {},
  spoken: Production = production
) => takeFingerprint({ ...scene, ...overrides }, 'en', spoken)

describe('takeFingerprint', () => {
  it('is the same for a scene that has not changed', () => {
    expect(fingerprint()).toBe(fingerprint())
  })

  it('changes when the line changes', () => {
    expect(fingerprint({ narration: 'Here is the recipe list.' })).not.toBe(
      fingerprint()
    )
  })

  it('changes when the delivery changes', () => {
    expect(fingerprint({ delivery: 'precise' })).not.toBe(fingerprint())
  })

  it('changes when the narrator changes', () => {
    const olivia = {
      ...production,
      narration: { ...production.narration, voice: 'voices/olivia.wav' },
    }

    expect(fingerprint({}, olivia)).not.toBe(fingerprint())
  })

  it('ignores what a scene does not affect', () => {
    expect(fingerprint({ beat: 'Something else entirely', tail: 4 })).toBe(
      fingerprint()
    )
  })

  it("takes the scene's own seed over the production's", () => {
    const seeded = {
      ...production,
      narration: { ...production.narration, seed: 11 },
    }

    expect(fingerprint({ seed: 11 })).toBe(fingerprint({}, seeded))
  })
})
