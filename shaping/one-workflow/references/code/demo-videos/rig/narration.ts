import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Production, Scene } from './screenplay'

const execFileAsync = promisify(execFile)

export const RIG_ROOT = path.resolve(import.meta.dirname, '..')

type NarrationReport = {
  output: string
  seconds: number
  sampleRate: number
  engine: string
  model: string
  chunks: number
  wordsPerMinute: number
  targetWordsPerMinute: number
  retimedBy: number
  clamped: boolean
  generationSeconds: number
  realTimeFactor: number
}

export type SpokenScene = NarrationReport & { take: string }

/** What the take was made from. A retake of a scene whose words did not change
 *  reuses the audio it already has, which is the difference between a
 *  ninety-second retake and a five-minute one. It is also how listening back
 *  tells a take that is still this scene's line from one that has been edited
 *  out from under its audio. */
export function takeFingerprint(
  scene: Scene,
  language: string,
  production: Production
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        text: scene.narration,
        language,
        delivery: scene.delivery ?? 'colleague',
        engine: production.narration.engine,
        voice: production.narration.voice,
        seed: scene.seed ?? production.narration.seed,
      })
    )
    .digest('hex')
}

/** The take sitting on disk for a scene, or null when it has never been
 *  spoken. */
export async function readTake(directory: string, sceneId: string) {
  try {
    const file = path.join(directory, `${sceneId}.json`)
    return JSON.parse(await readFile(file, 'utf8')) as SpokenScene
  } catch {
    return null
  }
}

export class ModelDriftError extends Error {
  constructor(pinned: string, spoke: string) {
    super(
      `The narration engine reported ${spoke}, but this project is pinned to ${pinned}. Every scene of a video has to be spoken by one model — re-render the whole cut or restore the pin.`
    )
  }
}

/** Speaks one scene through the rig's narration seam and writes the take beside
 *  a record of what it was made from. */
export async function speak(options: {
  scene: Scene
  language: string
  production: Production
  directory: string
  refresh: boolean
}): Promise<SpokenScene> {
  const { scene, language, production, directory } = options
  await mkdir(directory, { recursive: true })

  const wav = path.join(directory, `${scene.id}.wav`)
  const record = path.join(directory, `${scene.id}.json`)
  const take = takeFingerprint(scene, language, production)

  if (!options.refresh) {
    const existing = await readTake(directory, scene.id)
    if (existing?.take === take) return existing
  }

  const script = path.join(directory, `${scene.id}.txt`)
  await writeFile(script, scene.narration, 'utf8')

  await execFileAsync(
    path.join(RIG_ROOT, 'narrate.sh'),
    [
      '--text-file',
      script,
      '--out',
      wav,
      '--language',
      language,
      '--delivery',
      scene.delivery ?? 'colleague',
      '--voice',
      path.join(RIG_ROOT, production.narration.voice),
      '--engine',
      production.narration.engine,
      '--seed',
      String(scene.seed ?? production.narration.seed),
      '--report',
      record,
    ],
    { maxBuffer: 8 * 1024 * 1024 }
  )

  const report = JSON.parse(await readFile(record, 'utf8')) as NarrationReport
  if (report.model !== production.narration.model) {
    throw new ModelDriftError(production.narration.model, report.model)
  }

  const spoken: SpokenScene = { ...report, take }
  await writeFile(record, `${JSON.stringify(spoken, null, 2)}\n`, 'utf8')
  return spoken
}

export type Heard = {
  audio: string
  heard: string
  check?: {
    expectedWords: number
    heardWords: number
    wordAccuracy: number
    differences: { expected: string; heard: string }[]
  }
}

/** Listens back to a take and compares it with what the screenplay asked for.
 *  Narration that does not transcribe back to its line is a retake. */
export async function listenBack(options: {
  wav: string
  script: string
  language: string
  report: string
}): Promise<Heard> {
  await execFileAsync(
    path.join(RIG_ROOT, 'transcribe.sh'),
    [
      '--audio',
      options.wav,
      '--expect-file',
      options.script,
      '--language',
      options.language,
      '--report',
      options.report,
    ],
    { maxBuffer: 8 * 1024 * 1024 }
  )
  return JSON.parse(await readFile(options.report, 'utf8')) as Heard
}
