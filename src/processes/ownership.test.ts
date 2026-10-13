import { describe, expect, it } from 'vitest'
import {
  classifyOwnership,
  describeOwnership,
  environmentFromProcFile,
  environmentsFromPsOutput,
  isKillable,
  type ProcessSnapshot,
  startTimesFromPsOutput,
  sweeperClaudeProcessId,
} from './ownership.js'

const SECOND = 1000

function snapshot(
  startTimes: Record<number, number>,
  environments: Record<number, Record<string, string>>,
): ProcessSnapshot {
  return {
    startTimes: new Map(
      Object.entries(startTimes).map(([processId, started]) => [
        Number(processId),
        started,
      ]),
    ),
    environments: new Map(
      Object.entries(environments).map(([processId, environment]) => [
        Number(processId),
        environment,
      ]),
    ),
  }
}

const sweeper = 100
const otherClaude = 200
const candidate = { processId: 500, command: 'node server.js' }

describe('classifyOwnership', () => {
  it("owns a process marked with the sweeper's own Claude Code instance", () => {
    const table = snapshot({ 100: 0, 500: 10 * SECOND }, { 500: { CLAUDE_PID: '100' } })
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'mine' })
  })

  it('attributes a process to another instance that still runs', () => {
    const table = snapshot(
      { 200: 0, 500: 10 * SECOND },
      { 500: { CLAUDE_PID: '200', CLAUDE_CODE_SESSION_ID: 'session-b' } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'live-session',
      claudeProcessId: otherClaude,
      sessionId: 'session-b',
    })
  })

  it('counts an instance started in the same second as the process as still running', () => {
    const table = snapshot(
      { 200: 10 * SECOND, 500: 10 * SECOND },
      { 500: { CLAUDE_PID: '200' } },
    )
    expect(classifyOwnership(candidate, table, sweeper).kind).toBe('live-session')
  })

  it('attributes a process to an ended session when its instance no longer runs', () => {
    const table = snapshot(
      { 500: 10 * SECOND },
      { 500: { CLAUDE_PID: '200', CLAUDE_CODE_SESSION_ID: 'session-b' } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'ended-session',
      claudeProcessId: otherClaude,
      sessionId: 'session-b',
    })
  })

  it('reads a recycled pid — one started after the process it marks — as an ended session', () => {
    const table = snapshot(
      { 200: 11 * SECOND, 500: 10 * SECOND },
      { 500: { CLAUDE_PID: '200' } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'ended-session',
      claudeProcessId: otherClaude,
    })
  })

  it('leaves a process without the marker unmarked', () => {
    const table = snapshot({ 500: 10 * SECOND }, { 500: { PATH: '/usr/bin' } })
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'unmarked' })
  })

  it('leaves a process whose environment cannot be read unmarked', () => {
    const table = snapshot({ 500: 10 * SECOND }, {})
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'unmarked' })
  })

  it('leaves a process with a malformed marker unmarked', () => {
    for (const marker of ['', '0', '-4', '12abc']) {
      const table = snapshot({ 500: 10 * SECOND }, { 500: { CLAUDE_PID: marker } })
      expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'unmarked' })
    }
  })

  it('owns nothing when the sweeper runs outside Claude Code', () => {
    const table = snapshot({ 100: 0, 500: 10 * SECOND }, { 500: { CLAUDE_PID: '100' } })
    expect(classifyOwnership(candidate, table, undefined)).toEqual({
      kind: 'live-session',
      claudeProcessId: sweeper,
    })
    expect(
      classifyOwnership(
        candidate,
        snapshot({ 500: 0 }, { 500: { CLAUDE_PID: '100' } }),
        undefined,
      ),
    ).toEqual({
      kind: 'ended-session',
      claudeProcessId: sweeper,
    })
  })

  it('counts a Claude Code instance itself as a live session, whatever its environment', () => {
    const table = snapshot({ 600: 0 }, { 600: { CLAUDE_PID: '100' } })
    for (const command of [
      'claude',
      'claude --model opus',
      '/Users/dev/.local/bin/claude -c',
      '/Users/dev/.local/share/claude/versions/2.1.296 --resume',
      'node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    ]) {
      expect(classifyOwnership({ processId: 600, command }, table, sweeper)).toEqual({
        kind: 'live-session',
        claudeProcessId: 600,
      })
    }
  })
})

describe('isKillable', () => {
  it("kills only the sweeper's own processes and those of ended sessions", () => {
    expect(isKillable({ kind: 'mine' })).toBe(true)
    expect(isKillable({ kind: 'ended-session', claudeProcessId: 1 })).toBe(true)
    expect(isKillable({ kind: 'live-session', claudeProcessId: 1 })).toBe(false)
    expect(isKillable({ kind: 'unmarked' })).toBe(false)
  })
})

describe('describeOwnership', () => {
  it('names the instance and, when known, the session', () => {
    expect(describeOwnership({ kind: 'mine' })).toBe('mine')
    expect(describeOwnership({ kind: 'unmarked' })).toBe('unmarked')
    expect(describeOwnership({ kind: 'ended-session', claudeProcessId: 7 })).toBe(
      'ended session (Claude Code pid 7)',
    )
    expect(
      describeOwnership({ kind: 'live-session', claudeProcessId: 7, sessionId: 'abc' }),
    ).toBe('another live session (Claude Code pid 7, session abc)')
  })
})

describe('sweeperClaudeProcessId', () => {
  it("reads the sweeper's own marker, and nothing from outside Claude Code", () => {
    expect(sweeperClaudeProcessId({ CLAUDE_PID: '4242' })).toBe(4242)
    expect(sweeperClaudeProcessId({})).toBeUndefined()
    expect(sweeperClaudeProcessId({ CLAUDE_PID: 'nope' })).toBeUndefined()
  })
})

describe('startTimesFromPsOutput', () => {
  it('parses UTC start times at whole-second resolution', () => {
    const output = [
      '    1 Mon Aug 31 21:25:36 2026    ',
      '96511 Tue Oct  6 16:10:35 2026',
      '',
    ].join('\n')
    expect(startTimesFromPsOutput(output)).toEqual(
      new Map([
        [1, Date.UTC(2026, 7, 31, 21, 25, 36)],
        [96511, Date.UTC(2026, 9, 6, 16, 10, 35)],
      ]),
    )
  })
})

describe('environmentFromProcFile', () => {
  it('splits the NUL-separated environment at the first equals sign', () => {
    expect(environmentFromProcFile('CLAUDE_PID=42\0OPTIONS=a=b\0EMPTY=\0')).toEqual({
      CLAUDE_PID: '42',
      OPTIONS: 'a=b',
      EMPTY: '',
    })
  })

  it('keeps the first of a repeated variable, as the process itself reads it', () => {
    expect(environmentFromProcFile('CLAUDE_PID=1\0CLAUDE_PID=2\0')).toEqual({
      CLAUDE_PID: '1',
    })
  })
})

describe('environmentsFromPsOutput', () => {
  it('takes what the environment listing adds after each command line', () => {
    const commands = [
      '  500 node server.js --port 3000',
      '  600 /bin/sleep 100',
      '',
    ].join('\n')
    const withEnvironments = [
      '  500 node server.js --port 3000 PATH=/usr/bin CLAUDE_PID=42 CLAUDE_CODE_SESSION_ID=abc HOME=/Users/dev',
      '  600 /bin/sleep 100',
      '',
    ].join('\n')
    expect(environmentsFromPsOutput(commands, withEnvironments)).toEqual(
      new Map([
        [
          500,
          {
            PATH: '/usr/bin',
            CLAUDE_PID: '42',
            CLAUDE_CODE_SESSION_ID: 'abc',
            HOME: '/Users/dev',
          },
        ],
      ]),
    )
  })

  it('does not mistake an argument for an environment variable', () => {
    const commands = '  500 env-runner CLAUDE_PID=99\n'
    const withEnvironments = '  500 env-runner CLAUDE_PID=99 CLAUDE_PID=42\n'
    expect(environmentsFromPsOutput(commands, withEnvironments).get(500)).toEqual({
      CLAUDE_PID: '42',
    })
  })

  it('reads nothing for a process that exited between the two listings', () => {
    expect(environmentsFromPsOutput('  500 node a\n', '')).toEqual(new Map())
  })
})
