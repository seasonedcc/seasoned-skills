import { afterEach, expect } from 'vitest'
import { isTracked } from './dummy-processes.js'

/**
 * A test may signal only the processes it started itself: a sweep under test
 * that reaches past its dummies — a real browser, another session's server —
 * is refused here instead of killing it, and the test that tried fails.
 * Probing a pid with signal 0 stays open.
 */

const deliver = process.kill.bind(process)
const refused: number[] = []

process.kill = (processId: number, signal?: string | number) => {
  if (signal !== 0 && !isTracked(processId)) {
    refused.push(processId)
    throw Object.assign(
      new Error(`a test may only signal the processes it started, not pid ${processId}`),
      { code: 'EPERM' },
    )
  }
  return deliver(processId, signal)
}

afterEach(() => {
  expect(refused.splice(0), 'pids a test tried to signal beyond its own').toEqual([])
})
