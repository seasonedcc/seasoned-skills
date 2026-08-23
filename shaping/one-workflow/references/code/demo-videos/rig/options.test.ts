import { describe, expect, it } from 'vitest'
import { parseArguments } from './options'

describe('parseArguments', () => {
  it('reads the project and the cut', () => {
    const options = parseArguments(['rig-sample', 'proof'])

    expect(options.slug).toBe('rig-sample')
    expect(options.cut).toBe('proof')
    expect(options.scene).toBeUndefined()
  })

  it('does not mistake an option value for the cut', () => {
    const options = parseArguments([
      'rig-sample',
      '--scene',
      'scene-02-search',
      'proof',
    ])

    expect(options.cut).toBe('proof')
    expect(options.scene).toBe('scene-02-search')
  })

  it('reads the bare options', () => {
    const options = parseArguments([
      'rig-sample',
      'proof',
      '--assemble',
      '--check',
      '--refresh-narration',
    ])

    expect(options.assembleOnly).toBe(true)
    expect(options.check).toBe(true)
    expect(options.refreshNarration).toBe(true)
  })

  it('refuses an option it does not know rather than ignoring it', () => {
    expect(() => parseArguments(['rig-sample', 'proof', '--scenes'])).toThrow(
      'Unknown option: --scenes'
    )
  })

  it('refuses an option whose value was swallowed by the next option', () => {
    expect(() =>
      parseArguments(['rig-sample', 'proof', '--scene', '--check'])
    ).toThrow('--scene needs a value')
  })

  it('refuses a trailing argument nobody asked for', () => {
    expect(() => parseArguments(['rig-sample', 'proof', 'extra'])).toThrow(
      'Unexpected argument(s): extra'
    )
  })

  it('refuses to run without a project and a cut', () => {
    expect(() => parseArguments(['rig-sample'])).toThrow('Renders a demo video')
  })
})
