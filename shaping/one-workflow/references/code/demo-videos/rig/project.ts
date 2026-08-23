import { access, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { RIG_ROOT } from './narration'
import type { Production, Screenplay } from './screenplay'

export const PROJECTS_ROOT = path.resolve(RIG_ROOT, '..', '..', 'demo-videos')

async function importDefault<T>(file: string, what: string): Promise<T> {
  try {
    await access(file)
  } catch {
    throw new Error(`No ${what} at ${path.relative(process.cwd(), file)}`)
  }
  const module = await import(pathToFileURL(file).href)
  if (!module.default) {
    throw new Error(
      `${path.relative(process.cwd(), file)} has no default export — a ${what} is exported as default.`
    )
  }
  return module.default as T
}

export type Project = {
  slug: string
  cut: string
  source: string
  production: Production
  screenplay: Screenplay
  output: string
  footageDirectory: string
  narrationDirectory: string
  cutsDirectory: string
  framesDirectory: string
  video: string
  report: string
}

export type FinishedCut = Pick<Project, 'slug' | 'cut' | 'source' | 'video'>

function calendarDay(on: Date) {
  return [
    on.getFullYear(),
    String(on.getMonth() + 1).padStart(2, '0'),
    String(on.getDate()).padStart(2, '0'),
  ].join('-')
}

/** Where a finished cut is kept for somebody to hand over: beside the
 *  screenplay it was filmed from, so the video is where its source is rather
 *  than several directories away from it.
 *
 *  The name carries the day it was assembled and the whole project, because
 *  these files are sent to people who will never see the repo and the filename
 *  is all they get. Assembling again the same day replaces that day's video;
 *  assembling on a later day writes a new one and leaves it, so the folder
 *  keeps every version anybody was sent. */
export function handOverPath(finished: FinishedCut, on: Date) {
  return path.join(
    finished.source,
    `${calendarDay(on)}-${finished.slug}-${finished.cut}.mp4`
  )
}

export async function handOver(finished: FinishedCut, on: Date) {
  const handedOver = handOverPath(finished, on)
  await copyFile(finished.video, handedOver)
  return handedOver
}

/** Everything one cut of one video is made of and rendered into.
 *
 *  Source lives under `demo-videos/<slug>/` and is committed: the screenplays,
 *  the production config, the scope record and the demo-state recipe. Anything
 *  the rig produces from them — footage, narration, cuts, frames, the video
 *  itself — lands under the rig's gitignored `out/`, because all of it can be
 *  made again from the source and none of it belongs in the history. The
 *  finished video is copied back beside the source as well, and that copy is
 *  gitignored for the same reason. */
export async function loadProject(slug: string, cut: string): Promise<Project> {
  const source = path.join(PROJECTS_ROOT, slug)
  const production = await importDefault<Production>(
    path.join(source, 'production.ts'),
    'production config'
  )
  const screenplay = await importDefault<Screenplay>(
    path.join(source, `${cut}.ts`),
    'screenplay'
  )

  if (screenplay.slug !== slug || screenplay.cut !== cut) {
    throw new Error(
      `${slug}/${cut}.ts calls itself ${screenplay.slug}/${screenplay.cut}. The screenplay's slug and cut name where it lives.`
    )
  }

  const last = screenplay.scenes[screenplay.scenes.length - 1]
  if (!last) throw new Error(`${slug}/${cut} has no scenes`)
  if (!last.narration.includes(screenplay.closingAsk)) {
    throw new Error(
      `${slug}/${cut} never asks for the feedback it says it wants. The last scene's narration has to say: "${screenplay.closingAsk}"`
    )
  }

  const seen = new Set<string>()
  for (const scene of screenplay.scenes) {
    if (seen.has(scene.id)) {
      throw new Error(`${slug}/${cut} has two scenes called ${scene.id}`)
    }
    seen.add(scene.id)
  }

  const output = path.join(RIG_ROOT, 'out', slug, cut)
  return {
    slug,
    cut,
    source,
    production,
    screenplay,
    output,
    footageDirectory: path.join(output, 'footage'),
    narrationDirectory: path.join(output, 'narration'),
    cutsDirectory: path.join(output, 'cuts'),
    framesDirectory: path.join(output, 'frames'),
    video: path.join(output, `${slug}-${cut}.mp4`),
    report: path.join(output, 'report.json'),
  }
}
