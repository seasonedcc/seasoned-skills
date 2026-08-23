import { describe, expect, it } from 'vitest'
import { assembleArgs, cutArgs, parseClapperEnd } from './ffmpeg'
import { HUMAN_PACING, type Production } from './screenplay'

const production: Production = {
  productCommit: 'abc1234',
  baseUrl: 'http://localhost:7002',
  resolution: { width: 1280, height: 720 },
  fps: 30,
  narration: {
    engine: 'chatterbox',
    model: 'mlx-community/chatterbox-multilingual-v3',
    voice: 'voices/emily.wav',
    seed: 1,
  },
  video: { crf: 20, preset: 'medium', audioBitrate: '192k' },
  pacing: HUMAN_PACING,
}

describe('parseClapperEnd', () => {
  it('takes the end of the first black stretch it finds', () => {
    const output = [
      'frame= 12 fps=0.0 q=-0.0 size=N/A time=00:00:00.40',
      '[blackdetect @ 0x14e] black_start:0.6 black_end:0.88 black_duration:0.28',
      '[blackdetect @ 0x14e] black_start:9.2 black_end:9.4 black_duration:0.2',
    ].join('\n')

    expect(parseClapperEnd(output)).toBe(0.88)
  })

  it('reports nothing when the clapper never showed up', () => {
    expect(parseClapperEnd('frame= 12 fps=0.0 q=-0.0')).toBeNull()
  })
})

describe('cutArgs', () => {
  const args = cutArgs({
    footage: 'footage/scene-01.webm',
    narration: 'narration/scene-01.wav',
    from: 0.88,
    seconds: 21.5,
    production,
    output: 'cuts/scene-01.mkv',
  })
  const filter = args[args.indexOf('-filter_complex') + 1]

  it('starts the picture where the clapper ended', () => {
    expect(filter).toContain('trim=start=0.880:duration=21.500')
  })

  it('holds the last frame rather than ending early when a take ran short', () => {
    expect(filter).toContain('tpad=stop_mode=clone:stop_duration=2')
  })

  it('pads the narration with silence to the same length', () => {
    expect(filter).toContain('apad,atrim=duration=21.500')
  })

  it('keeps the sound lossless until the whole video is assembled', () => {
    expect(args).toContain('pcm_s16le')
  })

  it('lands at the production resolution and frame rate', () => {
    expect(filter).toContain('fps=30')
    expect(filter).toContain('scale=1280:720')
  })
})

describe('assembleArgs', () => {
  it('concatenates every cut in order, picture and sound together', () => {
    const args = assembleArgs(
      ['cuts/a.mkv', 'cuts/b.mkv', 'cuts/c.mkv'],
      production,
      'out.mp4'
    )

    expect(args.filter((argument) => argument === '-i')).toHaveLength(3)
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      '[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]'
    )
  })

  it('writes a file that starts playing before it has finished downloading', () => {
    const args = assembleArgs(['cuts/a.mkv'], production, 'out.mp4')

    expect(args).toContain('+faststart')
  })

  it('refuses to assemble nothing', () => {
    expect(() => assembleArgs([], production, 'out.mp4')).toThrow(
      'Nothing to assemble'
    )
  })
})
