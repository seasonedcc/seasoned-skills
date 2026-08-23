import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Browser, Locator, Page } from '@playwright/test'
import { type ScheduledMove, scheduleMoves } from './cues'
import { assertCursorDrawn, installCursor } from './cursor'
import { travelPath, typingCadence } from './pacing'
import type { Move, Production, Scene, Screenplay, Target } from './screenplay'
import { sessionCookie } from './session'

const HYDRATION_TIMEOUT = 180_000
const VISIBLE_TIMEOUT = 20_000
const CLAPPER_SECONDS = 0.25

const wait = (seconds: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000))

function describe(target: Target) {
  if ('role' in target) return `role=${target.role} name=${target.name ?? ''}`
  if ('text' in target) return `text=${target.text}`
  if ('label' in target) return `label=${target.label}`
  if ('placeholder' in target) return `placeholder=${target.placeholder}`
  return `css=${target.css}`
}

function locate(page: Page, target: Target): Locator {
  const found = (() => {
    if ('role' in target) {
      return page.getByRole(target.role, {
        name: target.name,
        exact: target.exact,
      })
    }
    if ('text' in target) return page.getByText(target.text)
    if ('label' in target) return page.getByLabel(target.label)
    if ('placeholder' in target)
      return page.getByPlaceholder(target.placeholder)
    return page.locator(target.css)
  })()
  return found.nth(target.nth ?? 0)
}

export class ChoreographyError extends Error {
  constructor(sceneId: string, index: number, move: Move, cause: string) {
    super(
      `[${sceneId}] move ${index + 1} (${move.do}) could not be performed: ${cause}\nThe product may have moved since this screenplay was written — reshape the move or refresh the screenplay.`
    )
  }
}

async function hydrated(page: Page) {
  await page.waitForFunction(
    `Object.keys(document.body).some((key) => key.startsWith('__reactFiber$'))`,
    undefined,
    { timeout: HYDRATION_TIMEOUT }
  )
  await page
    .waitForLoadState('networkidle', { timeout: 30_000 })
    .catch(() => {})
}

/** The centre of what a move is about, brought on screen first if it is not
 *  already there. Scrolling is smooth and then given time to land, because the
 *  camera is running and a jump cut to a new scroll position reads as an edit
 *  nobody made.
 *
 *  A point move anchors on the words themselves — a full-width block's centre
 *  is beside its text, and a cursor resting in blank space reads as pointing
 *  at nothing. Clicks keep the element's own centre: where a click lands is
 *  product behaviour (a caret goes there), not presentation. */
async function centreOf(
  page: Page,
  target: Target,
  pacing: Production['pacing'],
  anchor: 'element' | 'text' = 'element'
) {
  const locator = locate(page, target)
  await locator
    .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT })
    .catch(() => {
      throw new Error(`nothing on screen matches ${describe(target)}`)
    })

  const viewport = page.viewportSize()
  const first = await locator.boundingBox()
  if (!first) {
    throw new Error(`${describe(target)} has no box on screen to point at`)
  }

  const offscreen =
    viewport !== null &&
    (first.y < 0 ||
      first.y + first.height > viewport.height ||
      first.x < 0 ||
      first.x + first.width > viewport.width)

  if (offscreen) {
    await locator.evaluate((element) =>
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    )
    await wait(pacing.scrollSettle)
  }

  const box = await locator.boundingBox()
  if (!box) {
    throw new Error(
      `${describe(target)} left the screen while it was scrolling`
    )
  }

  if (anchor === 'text') {
    const words = await locator.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const rect = range.getClientRects()[0]
        if (rect && rect.width > 0 && rect.height > 0) {
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }
        }
      }
      return null
    })
    if (words) {
      return { x: words.x + words.width / 2, y: words.y + words.height / 2 }
    }
  }

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

type Cursor = { x: number; y: number }

async function travel(
  page: Page,
  cursor: Cursor,
  to: Cursor,
  production: Production,
  seed: number
) {
  for (const step of travelPath(cursor, to, production.pacing, seed)) {
    await page.mouse.move(step.x, step.y)
    await wait(step.after)
  }
  cursor.x = to.x
  cursor.y = to.y
}

type Beat = {
  /** Seconds since the top of the scene. */
  elapsed: () => number
  /** When the narrator reaches the next cue, if there is one. */
  nextCueAt: number | null
}

async function perform(
  page: Page,
  move: Move,
  cursor: Cursor,
  production: Production,
  seed: number,
  beat: Beat
) {
  const { pacing } = production

  if (move.do === 'hold') return wait(move.seconds)

  if (move.do === 'press') {
    await page.keyboard.press(move.key)
    return wait(pacing.settleAfterClick)
  }

  if (move.do === 'expect') {
    await locate(page, move.until)
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT })
      .catch(() => {
        throw new Error(`${describe(move.until)} never appeared`)
      })
    return
  }

  if (move.do === 'scroll') {
    const locator = locate(page, move.to)
    await locator
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT })
      .catch(() => {
        throw new Error(`nothing on screen matches ${describe(move.to)}`)
      })
    await locator.evaluate((element) =>
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    )
    return wait(pacing.scrollSettle)
  }

  if (move.do === 'point') {
    await travel(
      page,
      cursor,
      await centreOf(page, move.at, pacing, 'text'),
      production,
      seed
    )
    if (move.hold !== undefined) return wait(move.hold)
    if (beat.nextCueAt === null) return wait(pacing.pointHold)
    return wait(Math.max(pacing.minimumDwell, beat.nextCueAt - beat.elapsed()))
  }

  if (move.do === 'click') {
    await travel(
      page,
      cursor,
      await centreOf(page, move.at, pacing),
      production,
      seed
    )
    await wait(pacing.settleBeforeClick)
    await page.mouse.down()
    await wait(0.08)
    await page.mouse.up()
    return wait(pacing.settleAfterClick)
  }

  await travel(
    page,
    cursor,
    await centreOf(page, move.into, pacing),
    production,
    seed
  )
  await wait(pacing.settleBeforeClick)
  await page.mouse.down()
  await wait(0.08)
  await page.mouse.up()
  await wait(0.25)
  for (const stroke of typingCadence(move.text, pacing)) {
    await page.keyboard.type(stroke.character)
    await wait(stroke.after)
  }
}

export type MoveTiming = {
  move: string
  cue?: string
  scheduledAt: number | null
  startedAt: number
  endedAt: number
  /** How late the move was against its cue, in seconds. Negative means the
   *  performer waited for the narrator. */
  drift: number | null
}

export type SceneTake = {
  sceneId: string
  footage: string
  seconds: number
  timings: MoveTiming[]
  worstDrift: number
}

/** Records one scene.
 *
 *  Narration leads and footage follows: the take is already spoken, so every
 *  move knows the second it is meant to land on and waits for it. When a move
 *  runs long the ones after it are late rather than dropped, and the drift is
 *  reported rather than hidden — a scene whose choreography cannot keep up with
 *  its own narration is a screenplay to rewrite, not a take to accept. */
export async function record(options: {
  browser: Browser
  screenplay: Screenplay
  scene: Scene
  production: Production
  narrationSeconds: number
  footage: string
}): Promise<SceneTake> {
  const { browser, screenplay, scene, production } = options
  const scheduled = scheduleMoves(
    scene.id,
    scene.narration,
    options.narrationSeconds,
    scene.choreography
  )

  const actor = scene.open.as ?? screenplay.actor
  const cookie = await sessionCookie(actor)
  const directory = path.dirname(options.footage)
  await mkdir(directory, { recursive: true })

  const context = await browser.newContext({
    viewport: production.resolution,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    recordVideo: { dir: directory, size: production.resolution },
  })
  await context.addCookies([cookie])
  await installCursor(context)

  const page = await context.newPage()
  const video = page.video()

  let timings: MoveTiming[] = []
  let seconds = 0
  try {
    await page.goto(`${production.baseUrl}${scene.open.path}`, {
      waitUntil: 'domcontentloaded',
    })
    await hydrated(page)
    await assertCursorDrawn(page)

    const landed = new URL(page.url()).pathname
    if (landed !== scene.open.path.split('?')[0]) {
      throw new Error(
        `[${scene.id}] opening ${scene.open.path} landed on ${landed} — check the actor's permissions in DEMO-STATE.md`
      )
    }

    const cursor = {
      x: Math.round(production.resolution.width * 0.42),
      y: Math.round(production.resolution.height * 0.62),
    }
    await page.mouse.move(cursor.x, cursor.y)
    await wait(0.4)

    await page.evaluate('window.__demoRigClapper(true)')
    await wait(CLAPPER_SECONDS)
    await page.evaluate('window.__demoRigClapper(false)')

    const top = Date.now()
    timings = await performAll(
      page,
      scheduled,
      cursor,
      production,
      scene.id,
      top
    )

    const tail = scene.tail ?? production.pacing.tail
    const until = options.narrationSeconds + tail
    await wait(until - (Date.now() - top) / 1000)
    seconds = Math.max(until, (Date.now() - top) / 1000)
  } finally {
    await context.close()
  }

  if (!video) throw new Error(`[${scene.id}] Chromium recorded no video`)
  await video.saveAs(options.footage)
  await video.delete().catch(() => {})

  return {
    sceneId: scene.id,
    footage: options.footage,
    seconds,
    timings,
    worstDrift: timings.reduce(
      (worst, timing) => Math.max(worst, timing.drift ?? 0),
      0
    ),
  }
}

async function performAll(
  page: Page,
  scheduled: ScheduledMove[],
  cursor: Cursor,
  production: Production,
  sceneId: string,
  top: number
) {
  const timings: MoveTiming[] = []
  const elapsed = () => (Date.now() - top) / 1000
  for (const [index, { move, startsAt }] of scheduled.entries()) {
    const drift = startsAt === null ? null : elapsed() - startsAt
    if (drift !== null && drift < 0) await wait(-drift)

    const startedAt = elapsed()
    const nextCueAt =
      scheduled.slice(index + 1).find((next) => next.startsAt !== null)
        ?.startsAt ?? null
    try {
      await perform(page, move, cursor, production, index + 1, {
        elapsed,
        nextCueAt,
      })
    } catch (error) {
      throw new ChoreographyError(
        sceneId,
        index,
        move,
        error instanceof Error ? error.message : String(error)
      )
    }
    timings.push({
      move: move.do,
      cue: move.cue,
      scheduledAt: startsAt,
      startedAt,
      endedAt: elapsed(),
      drift: drift === null ? null : Math.max(0, drift),
    })
  }
  return timings
}
