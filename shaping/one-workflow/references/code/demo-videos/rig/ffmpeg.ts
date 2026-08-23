import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Production } from './screenplay'

const execFileAsync = promisify(execFile)

async function run(command: 'ffmpeg' | 'ffprobe', args: string[]) {
  try {
    return await execFileAsync(command, args, { maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const detail = error as { stderr?: string; message?: string }
    throw new Error(
      `${command} failed:\n${detail.stderr?.trim() || detail.message}`
    )
  }
}

export async function mediaSeconds(file: string) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ])
  const seconds = Number(stdout.trim())
  if (!Number.isFinite(seconds)) {
    throw new Error(`ffprobe could not measure ${file}`)
  }
  return seconds
}

/** Where the black square the performer flashes before it starts moving stops
 *  being black. That instant is the top of the scene: the narration is muxed
 *  from there, and everything before it — opening the page, waiting for it to
 *  hydrate, parking the cursor — is cut away.
 *
 *  Taking the mark off the picture rather than off the clock is the point.
 *  Chromium starts recording somewhere inside the first few hundred
 *  milliseconds of a context's life and does not say where, so any arithmetic
 *  from wall-clock timestamps is an estimate. This is a measurement. */
function clapperArgs(footage: string) {
  return [
    '-v',
    'info',
    '-i',
    footage,
    '-vf',
    'crop=32:32:0:0,blackdetect=d=0.04:pic_th=0.95:pix_th=0.12',
    '-an',
    '-f',
    'null',
    '-',
  ]
}

export function parseClapperEnd(ffmpegOutput: string) {
  const matches = [
    ...ffmpegOutput.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g),
  ]
  if (matches.length === 0) return null
  return Number(matches[0][2])
}

export async function findClapperEnd(footage: string) {
  try {
    const { stderr } = await run('ffmpeg', clapperArgs(footage))
    return parseClapperEnd(stderr)
  } catch {
    return null
  }
}

/** One scene, cut to the length of its narration and given that narration as
 *  its sound. The video is trimmed rather than seeked, so the cut lands on the
 *  frame the measurement named instead of the nearest keyframe, and the audio
 *  is padded with silence so a take that ran short still fills the scene. */
export function cutArgs(options: {
  footage: string
  narration: string
  from: number
  seconds: number
  production: Production
  output: string
}) {
  const { width, height } = options.production.resolution
  const { fps } = options.production
  const trim = options.from.toFixed(3)
  const duration = options.seconds.toFixed(3)

  return [
    '-y',
    '-i',
    options.footage,
    '-i',
    options.narration,
    '-filter_complex',
    [
      `[0:v]trim=start=${trim}:duration=${duration},setpts=PTS-STARTPTS,`,
      `fps=${fps},scale=${width}:${height}:flags=lanczos,`,
      'tpad=stop_mode=clone:stop_duration=2,',
      `trim=duration=${duration},setpts=PTS-STARTPTS,format=yuv420p[v];`,
      `[1:a]aresample=48000,apad,atrim=duration=${duration},`,
      'asetpts=PTS-STARTPTS[a]',
    ].join(''),
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    options.production.video.preset,
    '-crf',
    String(options.production.video.crf),
    '-c:a',
    'pcm_s16le',
    options.output,
  ]
}

export async function cutScene(options: Parameters<typeof cutArgs>[0]) {
  await run('ffmpeg', cutArgs(options))
  return options.output
}

/** Every scene end to end. The cuts are re-encoded through the concat filter
 *  rather than stitched by the demuxer: it costs one more pass and it is the
 *  only way a boundary is guaranteed to land on a frame with no gap and no
 *  audio priming click between scenes. */
export function assembleArgs(
  cuts: string[],
  production: Production,
  output: string
) {
  if (cuts.length === 0) throw new Error('Nothing to assemble: no scene cuts')
  const inputs = cuts.flatMap((cut) => ['-i', cut])
  const streams = cuts.map((_, index) => `[${index}:v][${index}:a]`).join('')

  return [
    '-y',
    ...inputs,
    '-filter_complex',
    `${streams}concat=n=${cuts.length}:v=1:a=1[v][a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    production.video.preset,
    '-crf',
    String(production.video.crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    production.video.audioBitrate,
    '-movflags',
    '+faststart',
    output,
  ]
}

export async function assemble(
  cuts: string[],
  production: Production,
  output: string
) {
  await run('ffmpeg', assembleArgs(cuts, production, output))
  return output
}

/** Stills for the self-review to read as pictures. */
function framesArgs(video: string, everySeconds: number, pattern: string) {
  return [
    '-y',
    '-i',
    video,
    '-vf',
    `fps=1/${everySeconds}`,
    '-q:v',
    '3',
    pattern,
  ]
}

export async function extractFrames(
  video: string,
  everySeconds: number,
  pattern: string
) {
  await run('ffmpeg', framesArgs(video, everySeconds, pattern))
}

export async function assertFfmpeg() {
  try {
    await run('ffprobe', ['-version'])
  } catch {
    throw new Error(
      'ffmpeg is not on PATH. The rig needs it to cut and assemble; install it with `brew install ffmpeg`.'
    )
  }
}
