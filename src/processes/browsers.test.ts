import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  endedProcessId,
  exits,
  isRunning,
  spawnDummy,
  spawnOrphan,
  spawnSessionWithChild,
  stopDummies,
} from '../../tests/unit/dummy-processes.js'
import { browserListingOf, fakeBrowserPs } from '../../tests/unit/fake-commands.js'
import {
  browserProcessesFromPsOutput,
  killBrowserProcesses,
  listBrowserProcesses,
} from './browsers.js'

describe('browserProcessesFromPsOutput', () => {
  it("keeps this user's agent-browser daemons and Chrome for Testing processes", () => {
    const output = [
      '  101   501 01:02 /opt/homebrew/lib/node_modules/agent-browser/bin/agent-browser-darwin-arm64',
      '  102   501 1-02:03:04 /Users/dev/.agent-browser/browsers/chrome-146/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --headless',
      '  103   502 01:02 /home/other/.agent-browser/bin/agent-browser-linux-x64',
      '  104   501 01:02 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '  105   501 01:02 node server.js',
      '',
    ].join('\n')
    expect(browserProcessesFromPsOutput(output, 501)).toEqual([
      {
        processId: 101,
        age: '01:02',
        kind: 'agent-browser daemon',
        command:
          '/opt/homebrew/lib/node_modules/agent-browser/bin/agent-browser-darwin-arm64',
      },
      {
        processId: 102,
        age: '1-02:03:04',
        kind: 'Chrome for Testing',
        command:
          '/Users/dev/.agent-browser/browsers/chrome-146/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --headless',
      },
    ])
  })
})

describe('the browser sweep against real processes', () => {
  let fakes: string

  beforeEach(() => {
    fakes = mkdtempSync(join(tmpdir(), 'seasoned-skills-browsers-'))
  })

  afterEach(() => {
    stopDummies()
    vi.unstubAllEnvs()
    rmSync(fakes, { recursive: true, force: true })
  })

  it('classifies each browser process and kills only the killable ones', {
    timeout: 30_000,
  }, async () => {
    vi.stubEnv('CLAUDE_PID', String(process.pid))
    const label = 'agent-browser-linux-x64'
    const endedSession = await endedProcessId()
    const [mine, ended, live, unmarked] = await Promise.all([
      spawnDummy(tmpdir(), { label, marker: { claudeProcessId: process.pid } }),
      spawnOrphan(tmpdir(), { label, marker: { claudeProcessId: endedSession } }),
      spawnSessionWithChild(tmpdir(), 'other-session', { label }),
      spawnOrphan(tmpdir(), { label }),
    ])
    fakeBrowserPs(fakes, {
      browsers: browserListingOf([mine, ended, live.child, unmarked]),
    })

    const listed = listBrowserProcesses()
    expect(
      Object.fromEntries(listed.map((browser) => [browser.processId, browser.ownership])),
    ).toEqual({
      [mine.pid]: { kind: 'mine' },
      [ended.pid]: { kind: 'ended-session', claudeProcessId: endedSession },
      [live.child.pid]: {
        kind: 'live-session',
        claudeProcessId: live.session.pid,
        sessionId: 'other-session',
      },
      [unmarked.pid]: { kind: 'unmarked' },
    })
    expect(listed.every((browser) => browser.kind === 'agent-browser daemon')).toBe(true)

    const killed = killBrowserProcesses(listed)
    expect(killed.map((browser) => browser.processId).sort()).toEqual(
      [mine.pid, ended.pid].sort(),
    )
    expect(await Promise.all([exits(mine), exits(ended)])).toEqual([true, true])
    expect([live.child, unmarked].every(isRunning)).toBe(true)
  })
})
