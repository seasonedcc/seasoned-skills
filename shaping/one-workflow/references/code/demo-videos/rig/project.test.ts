import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type FinishedCut, handOver, handOverPath } from './project'

async function finishedCut(rendered: string): Promise<FinishedCut> {
  const root = await mkdtemp(path.join(tmpdir(), 'demo-video-'))
  const source = path.join(root, 'recipe-dna-moves-in')
  const video = path.join(root, 'out', 'recipe-dna-moves-in-highlights.mp4')
  await mkdir(source)
  await mkdir(path.dirname(video))
  await writeFile(video, rendered, 'utf8')
  return { slug: 'recipe-dna-moves-in', cut: 'highlights', source, video }
}

async function beside(finished: FinishedCut) {
  return (await readdir(finished.source)).sort()
}

describe('handOverPath', () => {
  it('names the video by the day it was assembled and the whole project', () => {
    const finished = {
      slug: 'recipe-dna-moves-in',
      cut: 'highlights',
      source: 'demo-videos/recipe-dna-moves-in',
      video:
        'scripts/demo-videos/out/recipe-dna-moves-in/highlights/recipe-dna-moves-in-highlights.mp4',
    }

    expect(handOverPath(finished, new Date(2026, 7, 18, 23, 45))).toBe(
      'demo-videos/recipe-dna-moves-in/2026-08-18-recipe-dna-moves-in-highlights.mp4'
    )
  })
})

describe('handOver', () => {
  it('copies the finished video beside the screenplay it was filmed from', async () => {
    const finished = await finishedCut('the cut')

    const handedOver = await handOver(finished, new Date(2026, 7, 18))

    expect(await readFile(handedOver, 'utf8')).toBe('the cut')
    expect(await beside(finished)).toEqual([
      '2026-08-18-recipe-dna-moves-in-highlights.mp4',
    ])
  })

  it('replaces that day of rendering when the cut is assembled again', async () => {
    const finished = await finishedCut('the first render')
    await handOver(finished, new Date(2026, 7, 18))
    await writeFile(finished.video, 'the retake', 'utf8')

    const handedOver = await handOver(finished, new Date(2026, 7, 18))

    expect(await readFile(handedOver, 'utf8')).toBe('the retake')
    expect(await beside(finished)).toHaveLength(1)
  })

  it('keeps the video of every earlier day it was rendered on', async () => {
    const finished = await finishedCut('the first render')
    await handOver(finished, new Date(2026, 7, 18))
    await writeFile(finished.video, 'the refresh', 'utf8')

    await handOver(finished, new Date(2026, 8, 2))

    expect(await beside(finished)).toEqual([
      '2026-08-18-recipe-dna-moves-in-highlights.mp4',
      '2026-09-02-recipe-dna-moves-in-highlights.mp4',
    ])
    expect(
      await readFile(
        path.join(
          finished.source,
          '2026-08-18-recipe-dna-moves-in-highlights.mp4'
        ),
        'utf8'
      )
    ).toBe('the first render')
  })
})
