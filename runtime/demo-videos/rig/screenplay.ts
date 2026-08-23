import type { Page } from '@playwright/test'

type Role = Parameters<Page['getByRole']>[0]

/** How a move names the thing on screen it is about. Prefer `role` and `text`:
 *  they survive a redesign that a CSS selector does not, and when they stop
 *  matching it is because the product moved, which is what a refresh run wants
 *  to hear about. */
export type Target =
  | { role: Role; name?: string; exact?: boolean; nth?: number }
  | { text: string; nth?: number }
  | { label: string; nth?: number }
  | { placeholder: string; nth?: number }
  | { css: string; nth?: number }

/** When a move happens. `cue` is a verbatim fragment of the scene's narration,
 *  and the move lands as the narrator reaches it; `atSecond` is a hard offset
 *  from the top of the scene. A move with neither follows the one before it. */
type Sync = { cue?: string; atSecond?: number }

export type Move = Sync &
  (
    | { do: 'point'; at: Target; hold?: number }
    | { do: 'click'; at: Target }
    | { do: 'type'; into: Target; text: string }
    | { do: 'press'; key: string }
    | { do: 'scroll'; to: Target }
    | { do: 'hold'; seconds: number }
    | { do: 'expect'; until: Target }
  )

export type Actor = { userEmail: string; companyName: string }

export type Scene = {
  /** File-safe and stable: it names this scene's footage, narration and cut, so
   *  a retake finds them again. */
  id: string
  /** One line for whoever reads the screenplay: what this scene is for. */
  beat: string
  /** What the narrator says. Spell alphanumeric identifiers out phonetically —
   *  "revision vee seventeen", not "V17". See the rig README. */
  narration: string
  delivery?: 'colleague' | 'precise' | 'engaged'
  /** Overrides the production's narration seed for this scene alone. Speech is
   *  stochastic: a take can repeat a clause, or read so far off the delivery's
   *  pace that the retimer cannot pull it back. Another seed is a different
   *  take, and pinning it here re-speaks one scene rather than the whole cut. */
  seed?: number
  /** The demo state this scene needs, in prose, checked by a person against the
   *  project's DEMO-STATE.md. An empty list means the scene needs nothing the
   *  seed does not already give it. */
  needs: string[]
  open: { path: string; as?: Actor }
  /** Routes the scene navigates into. They are compiled and cached before the
   *  camera rolls, so a lazy first render never stalls the middle of a take. */
  warm?: string[]
  choreography: Move[]
  /** Footage held after the narration ends, in seconds. Overrides the
   *  production's default. */
  tail?: number
}

export type Screenplay = {
  slug: string
  cut: string
  title: string
  /** ISO 639-1. The /demo-videos language rule settles this before it gets
   *  here: the language explicitly asked for, else the language the request was
   *  written in, else English. */
  language: string
  actor: Actor
  /** What feedback would help, named out loud in the last scene's narration.
   *  The runner checks that it is actually said. */
  closingAsk: string
  scenes: Scene[]
}

export type Pacing = {
  /** Cursor travel: speed, the floor and ceiling on how long one journey takes,
   *  and how many positions it is drawn at. */
  travel: {
    pixelsPerSecond: number
    shortest: number
    longest: number
    samples: number
    /** How far the path bows away from a straight line, as a fraction of the
     *  distance. A dead-straight cursor reads as a machine. */
    bow: number
  }
  /** The pause between arriving somewhere and clicking it — the beat a person
   *  takes to be sure they are on the right thing. */
  settleBeforeClick: number
  settleAfterClick: number
  typing: {
    secondsPerCharacter: number
    jitter: number
    afterWord: number
    afterPunctuation: number
  }
  /** How long `point` dwells when the move does not say and no cue follows it.
   *  When a cue does follow, a point rests on what it is showing until the
   *  narrator moves on, which is what a hand does. */
  pointHold: number
  /** The floor on that dwell. However tight the narration gets, the cursor
   *  never flicks past the thing it just arrived at. */
  minimumDwell: number
  /** How long a smooth scroll is given to finish. */
  scrollSettle: number
  /** Footage held after the narration ends, so a cut does not land on the last
   *  syllable. */
  tail: number
}

export type Production = {
  /** The product commit this project's demo state and choreography were
   *  recorded against. An exact reproduction checks out this commit; a refresh
   *  runs the same screenplay against current main and fails where the UI
   *  moved. */
  productCommit: string
  baseUrl: string
  resolution: { width: number; height: number }
  fps: number
  narration: {
    engine: string
    /** Checked against what the engine reports after speaking, so a silent
     *  model swap cannot change the voice of a half-rendered video. */
    model: string
    /** The narrator, relative to the rig root. */
    voice: string
    seed: number
  }
  video: { crf: number; preset: string; audioBitrate: string }
  pacing: Pacing
}

export const HUMAN_PACING: Pacing = {
  travel: {
    pixelsPerSecond: 900,
    shortest: 0.4,
    longest: 1.6,
    samples: 48,
    bow: 0.11,
  },
  settleBeforeClick: 0.35,
  settleAfterClick: 0.6,
  typing: {
    secondsPerCharacter: 0.075,
    jitter: 0.35,
    afterWord: 0.09,
    afterPunctuation: 0.22,
  },
  pointHold: 1.4,
  minimumDwell: 0.35,
  scrollSettle: 0.9,
  tail: 1.2,
}

export function defineProduction(production: Production) {
  return production
}

export function defineScreenplay(screenplay: Screenplay) {
  return screenplay
}
