import 'dotenv/config'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type Browser, chromium } from '@playwright/test'
import { db } from '~/db/db.server'
import {
  assemble,
  assertFfmpeg,
  cutScene,
  extractFrames,
  findClapperEnd,
  mediaSeconds,
} from './ffmpeg'
import { listenBack, readTake, speak, takeFingerprint } from './narration'
import { parseArguments } from './options'
import { type SceneTake, record } from './perform'
import { type Project, handOver, loadProject } from './project'
import type { Scene } from './screenplay'
import { sessionCookie } from './session'

const FRAME_EVERY_SECONDS = 4

type SceneRecord = SceneTake & {
  narrationSeconds: number
  clapperAt: number | null
  cut: string
}

type Report = {
  slug: string
  cut: string
  title: string
  language: string
  productCommit: string
  video: string
  seconds: number
  renderedAt: string
  scenes: SceneRecord[]
}

/** Vite compiles a route the first time a browser asks for it, and the wait is
 *  long enough to be visible. Every route a scene walks through is opened once
 *  off camera before the take, so nothing in the recording is waiting on a
 *  compiler. */
async function warm(browser: Browser, project: Project, scene: Scene) {
  const context = await browser.newContext({
    viewport: project.production.resolution,
  })
  try {
    await context.addCookies([
      await sessionCookie(scene.open.as ?? project.screenplay.actor),
    ])
    const page = await context.newPage()
    for (const route of [scene.open.path, ...(scene.warm ?? [])]) {
      await page.goto(`${project.production.baseUrl}${route}`, {
        waitUntil: 'domcontentloaded',
      })
      await page
        .waitForFunction(
          `Object.keys(document.body).some((key) => key.startsWith('__reactFiber$'))`,
          undefined,
          { timeout: 180_000 }
        )
        .catch(() => {})
    }
  } finally {
    await context.close()
  }
}

async function renderScene(
  browser: Browser,
  project: Project,
  scene: Scene,
  refreshNarration: boolean
): Promise<SceneRecord> {
  const spoken = await speak({
    scene,
    language: project.screenplay.language,
    production: project.production,
    directory: project.narrationDirectory,
    refresh: refreshNarration,
  })
  console.log(
    `  narration: ${spoken.seconds}s at ${spoken.wordsPerMinute} wpm (${spoken.chunks} chunk(s))`
  )
  if (spoken.clamped) {
    console.log(
      `  ! this take read too far off ${spoken.targetWordsPerMinute} wpm to be pulled all the way back, so it lands at ${spoken.wordsPerMinute}. Next to an unclamped scene the pace changes audibly — shorten or lengthen the line, or retake at another seed.`
    )
  }

  await warm(browser, project, scene)

  const footage = path.join(project.footageDirectory, `${scene.id}.webm`)
  await rm(footage, { force: true })
  const take = await record({
    browser,
    screenplay: project.screenplay,
    scene,
    production: project.production,
    narrationSeconds: spoken.seconds,
    footage,
  })

  const clapperAt = await findClapperEnd(footage)
  if (clapperAt === null) {
    throw new Error(
      `[${scene.id}] the clapper never showed up in the footage, so there is no honest place to start the narration. Re-record the scene.`
    )
  }

  await mkdir(project.cutsDirectory, { recursive: true })
  const cut = await cutScene({
    footage,
    narration: path.join(project.narrationDirectory, `${scene.id}.wav`),
    from: clapperAt,
    seconds: take.seconds,
    production: project.production,
    output: path.join(project.cutsDirectory, `${scene.id}.mkv`),
  })
  console.log(
    `  cut: ${take.seconds.toFixed(2)}s from ${clapperAt.toFixed(2)}s, worst cue drift ${take.worstDrift.toFixed(2)}s`
  )

  return { ...take, narrationSeconds: spoken.seconds, clapperAt, cut }
}

async function readReport(project: Project): Promise<Report | null> {
  try {
    return JSON.parse(await readFile(project.report, 'utf8')) as Report
  } catch {
    return null
  }
}

async function assembleCut(project: Project, scenes: SceneRecord[]) {
  const ordered = project.screenplay.scenes.map((scene) => {
    const rendered = scenes.find((taken) => taken.sceneId === scene.id)
    if (!rendered) {
      throw new Error(
        `Scene ${scene.id} has never been rendered, so the cut cannot be assembled. Render the whole cut once before retaking scenes.`
      )
    }
    return rendered
  })

  await assemble(
    ordered.map((scene) => scene.cut),
    project.production,
    project.video
  )

  await rm(project.framesDirectory, { recursive: true, force: true })
  await mkdir(project.framesDirectory, { recursive: true })
  await extractFrames(
    project.video,
    FRAME_EVERY_SECONDS,
    path.join(project.framesDirectory, 'frame-%03d.jpg')
  )

  const report: Report = {
    slug: project.slug,
    cut: project.cut,
    title: project.screenplay.title,
    language: project.screenplay.language,
    productCommit: project.production.productCommit,
    video: project.video,
    seconds: await mediaSeconds(project.video),
    renderedAt: new Date().toISOString(),
    scenes: ordered,
  }
  await writeFile(
    project.report,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  )
  const handedOver = await handOver(project, new Date())
  return { report, handedOver }
}

async function runCheck(project: Project) {
  let worst = 1
  for (const scene of project.screenplay.scenes) {
    const wav = path.join(project.narrationDirectory, `${scene.id}.wav`)
    const spoken = await access(wav).then(
      () => true,
      () => false
    )
    if (!spoken) {
      throw new Error(
        `${scene.id} has never been spoken, so there is nothing to listen back to. Render the cut first.`
      )
    }
    const take = await readTake(project.narrationDirectory, scene.id)
    const current = takeFingerprint(
      scene,
      project.screenplay.language,
      project.production
    )
    if (take?.take !== current) {
      throw new Error(
        `${scene.id} has been edited since it was last spoken, so listening back would check the audio against the line it replaced. Re-render it first:\n  pnpm run demo:video ${project.slug} ${project.cut} --scene ${scene.id}`
      )
    }
    const heard = await listenBack({
      wav,
      script: path.join(project.narrationDirectory, `${scene.id}.txt`),
      language: project.screenplay.language,
      report: path.join(project.narrationDirectory, `${scene.id}-heard.json`),
    })
    const accuracy = heard.check?.wordAccuracy ?? 0
    worst = Math.min(worst, accuracy)
    console.log(
      `${scene.id}: ${(accuracy * 100).toFixed(1)}% of the line came back`
    )
    for (const difference of heard.check?.differences ?? []) {
      console.log(
        `  script "${difference.expected}" — heard "${difference.heard}"`
      )
    }
  }
  console.log(
    `\nWorst scene: ${(worst * 100).toFixed(1)}%. Read every difference above: an identifier written phonetically comes back spelled, which is correct; a repeated or missing clause is a retake.`
  )
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const project = await loadProject(options.slug, options.cut)
  if (options.baseUrl) project.production.baseUrl = options.baseUrl

  if (options.check) return runCheck(project)

  await assertFfmpeg()
  await mkdir(project.output, { recursive: true })

  if (options.assembleOnly) {
    const previous = await readReport(project)
    if (!previous) {
      throw new Error(
        'There is nothing to assemble: this cut has never been rendered.'
      )
    }
    const { report, handedOver } = await assembleCut(project, previous.scenes)
    console.log(`\n${report.video} — ${report.seconds.toFixed(1)}s`)
    console.log(`to hand over: ${handedOver}`)
    return
  }

  const scenes = options.scene
    ? project.screenplay.scenes.filter((scene) => scene.id === options.scene)
    : project.screenplay.scenes
  if (scenes.length === 0) {
    throw new Error(
      `No scene called ${options.scene} in ${project.slug}/${project.cut}`
    )
  }

  const browser = await chromium.launch()
  const rendered: SceneRecord[] = []
  try {
    for (const scene of scenes) {
      console.log(`\n${scene.id} — ${scene.beat}`)
      rendered.push(
        await renderScene(browser, project, scene, options.refreshNarration)
      )
    }
  } finally {
    await browser.close()
  }

  const previous = options.scene
    ? ((await readReport(project))?.scenes ?? [])
    : []
  const merged = [
    ...previous.filter(
      (scene) => !rendered.some((fresh) => fresh.sceneId === scene.sceneId)
    ),
    ...rendered,
  ]

  const { report, handedOver } = await assembleCut(project, merged)
  console.log(
    `\n${report.video} — ${report.seconds.toFixed(1)}s, ${report.scenes.length} scene(s)`
  )
  console.log(`to hand over: ${handedOver}`)
  console.log(`frames for review: ${project.framesDirectory}`)
}

main().then(
  async () => {
    await db().destroy()
    process.exit(0)
  },
  async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await db()
      .destroy()
      .catch(() => {})
    process.exit(1)
  }
)
