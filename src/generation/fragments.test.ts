import { describe, expect, it } from 'vitest'
import { fillTokens, joinBlocks } from './fragments.js'

describe('fillTokens', () => {
  it('fills every marker', () => {
    expect(fillTokens('run {{lint}} then {{lint}} again', { lint: 'pnpm lint' })).toBe(
      'run pnpm lint then pnpm lint again',
    )
  })

  it('throws on an unfilled marker', () => {
    expect(() => fillTokens('run {{lint}}', {})).toThrow('unfilled token {{lint}}')
  })

  it('leaves single braces in code samples alone', () => {
    const code = 'echo "${PIPESTATUS[0]}" { a: 1 }'
    expect(fillTokens(code, {})).toBe(code)
  })
})

describe('joinBlocks', () => {
  it('joins present blocks and drops the conditionals that are off', () => {
    expect(joinBlocks('one', false, undefined, 'two\n')).toBe('one\n\ntwo\n')
  })
})
