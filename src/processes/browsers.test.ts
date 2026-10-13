import { type ChildProcess, spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const dummies: ChildProcess[] = []

  afterEach(() => {
    for (const dummy of dummies) if (dummy.exitCode === null) dummy.kill('SIGKILL')
    dummies.length = 0
    vi.unstubAllEnvs()
  })

  function spawnFakeDaemon(claudeProcessId?: number) {
    const environment = { ...process.env }
    delete environment.CLAUDE_PID
    if (claudeProcessId !== undefined) environment.CLAUDE_PID = String(claudeProcessId)
    const child = spawn(
      process.execPath,
      [
        '-e',
        "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
        'agent-browser-linux-x64',
      ],
      { env: environment, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    dummies.push(child)
    return new Promise<ChildProcess>((resolveChild) =>
      child.stdout?.once('data', () => resolveChild(child)),
    )
  }

  it('classifies each browser process and kills only the killable ones', {
    timeout: 30_000,
  }, async () => {
    vi.stubEnv('CLAUDE_PID', String(process.pid))
    const mine = await spawnFakeDaemon(process.pid)
    const unmarked = await spawnFakeDaemon()
    const ours = new Set([mine.pid, unmarked.pid])

    const listed = listBrowserProcesses().filter((browser) => ours.has(browser.processId))
    expect(
      Object.fromEntries(listed.map((browser) => [browser.processId, browser.ownership])),
    ).toEqual({
      [mine.pid as number]: { kind: 'mine' },
      [unmarked.pid as number]: { kind: 'unmarked' },
    })
    expect(listed.every((browser) => browser.kind === 'agent-browser daemon')).toBe(true)

    const killed = killBrowserProcesses(listed)
    expect(killed.map((browser) => browser.processId)).toEqual([mine.pid])
    await new Promise((resolveExit) => mine.once('exit', resolveExit))
    expect(unmarked.exitCode).toBeNull()
  })
})
