import { describe, expect, it } from 'vitest'
import {
  classifyOwnership,
  describeOwnership,
  isKillable,
  markerFromProcFile,
  markersFromPsOutput,
  type ProcessSnapshot,
  processesFromPsOutput,
} from './ownership.js'

const SECOND = 1000

type TableEntry = { parent?: number; started: number; command?: string }

function snapshot(
  processes: Record<number, TableEntry>,
  markers: Record<number, { claudeProcessId: number; sessionId?: string }> = {},
  processExists: (processId: number) => boolean = () => false,
): ProcessSnapshot {
  return {
    processes: new Map(
      Object.entries(processes).map(([processId, entry]) => [
        Number(processId),
        {
          parentProcessId: entry.parent ?? 1,
          started: entry.started,
          command: entry.command ?? 'node server.js',
        },
      ]),
    ),
    markers: new Map(
      Object.entries(markers).map(([processId, marker]) => [Number(processId), marker]),
    ),
    processExists,
  }
}

const sweeper = 100
const otherClaude = 200
const candidate = 500

describe('classifyOwnership by marker', () => {
  it("owns a process marked with the sweeper's own Claude Code instance", () => {
    const table = snapshot(
      { 100: { started: 0, command: 'claude' }, 500: { started: 10 * SECOND } },
      { 500: { claudeProcessId: sweeper } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'mine' })
  })

  it('attributes a process to another instance that still runs', () => {
    const table = snapshot(
      { 200: { started: 0 }, 500: { started: 10 * SECOND } },
      { 500: { claudeProcessId: otherClaude, sessionId: 'session-b' } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'live-session',
      claudeProcessId: otherClaude,
      sessionId: 'session-b',
    })
  })

  it('counts an instance started in the same second as the process as still running', () => {
    const table = snapshot(
      { 200: { started: 10 * SECOND }, 500: { started: 10 * SECOND } },
      { 500: { claudeProcessId: otherClaude } },
    )
    expect(classifyOwnership(candidate, table, sweeper).kind).toBe('live-session')
  })

  it('attributes a process to an ended session when its instance no longer exists', () => {
    const table = snapshot(
      { 500: { started: 10 * SECOND } },
      { 500: { claudeProcessId: otherClaude, sessionId: 'session-b' } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'ended-session',
      claudeProcessId: otherClaude,
      sessionId: 'session-b',
    })
  })

  it('counts an instance missing from the process table that still exists as running', () => {
    const table = snapshot(
      { 500: { started: 10 * SECOND } },
      { 500: { claudeProcessId: otherClaude } },
      () => true,
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'live-session',
      claudeProcessId: otherClaude,
    })
  })

  it('reads a recycled pid — one started after the process it marks — as an ended session', () => {
    const table = snapshot(
      { 200: { started: 11 * SECOND }, 500: { started: 10 * SECOND } },
      { 500: { claudeProcessId: otherClaude } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'ended-session',
      claudeProcessId: otherClaude,
    })
  })

  it('leaves an orphan without a readable marker unmarked', () => {
    const table = snapshot({ 500: { started: 10 * SECOND } })
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'unmarked' })
  })

  it('owns nothing when the sweeper runs outside Claude Code', () => {
    const marked = { 500: { claudeProcessId: sweeper } }
    expect(
      classifyOwnership(
        candidate,
        snapshot({ 100: { started: 0 }, 500: { started: 10 * SECOND } }, marked),
        undefined,
      ),
    ).toEqual({ kind: 'live-session', claudeProcessId: sweeper })
    expect(
      classifyOwnership(candidate, snapshot({ 500: { started: 0 } }, marked), undefined),
    ).toEqual({ kind: 'ended-session', claudeProcessId: sweeper })
  })

  it('counts a Claude Code instance itself as a live session, whatever its marker', () => {
    for (const command of [
      'claude',
      'claude --model opus',
      '/Users/dev/.local/bin/claude -c',
      '/Users/dev/.local/share/claude/versions/2.1.296 --resume',
      'node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      '/Users/dev/Library/Application Support/Claude/claude-code/2.1.296/0f3a9c/claude.app/Contents/MacOS/claude',
      '/Users/dev/Library/Application Support/Claude/claude-code/2.1.296/0f3a9c/claude.app/Contents/MacOS/claude --output-format stream-json',
      'node /Users/dev/app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js --output-format stream-json',
    ]) {
      const table = snapshot(
        { 600: { started: 0, command } },
        { 600: { claudeProcessId: sweeper } },
      )
      expect(classifyOwnership(600, table, sweeper)).toEqual({
        kind: 'live-session',
        claudeProcessId: 600,
      })
    }
  })

  it('does not take a command that merely mentions claude for Claude Code', () => {
    for (const command of [
      'node claude-helper.js',
      '/opt/claudette/bin/server',
      'vim notes-about-claude.md',
      'grep -r session /Users/dev/.local/share/claude/versions/2.1.296/notes',
    ]) {
      const table = snapshot(
        { 100: { started: 0, command: 'claude' }, 600: { started: 0, command } },
        { 600: { claudeProcessId: sweeper } },
      )
      expect(classifyOwnership(600, table, sweeper)).toEqual({ kind: 'mine' })
    }
  })
})

describe('classifyOwnership by ancestry', () => {
  it("owns a process that hides its environment when it runs under the sweeper's instance", () => {
    const table = snapshot({
      100: { started: 0, command: 'claude' },
      300: { parent: 100, started: 5 * SECOND, command: '/bin/zsh -c next dev' },
      500: { parent: 300, started: 10 * SECOND, command: 'next-server (v15.0.0)' },
    })
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'mine' })
  })

  it("owns a renamed child of a process marked with the sweeper's instance", () => {
    const table = snapshot(
      {
        100: { started: 0, command: 'claude' },
        400: { started: 5 * SECOND },
        500: { parent: 400, started: 10 * SECOND, command: 'next-server (v15.0.0)' },
      },
      { 400: { claudeProcessId: sweeper } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'mine' })
  })

  it('gives a process under another running Claude Code instance to that session', () => {
    const table = snapshot({
      200: { started: 0, command: '/Users/dev/.local/bin/claude' },
      300: { parent: 200, started: 5 * SECOND, command: '/bin/zsh' },
      500: { parent: 300, started: 10 * SECOND, command: 'next-server (v15.0.0)' },
    })
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'live-session',
      claudeProcessId: otherClaude,
    })
  })

  it('recognizes an instance by the marker of a process below it, naming its session', () => {
    const table = snapshot(
      {
        200: { started: 0, command: 'node /opt/agent/cli.js' },
        500: { parent: 200, started: 10 * SECOND },
      },
      { 500: { claudeProcessId: otherClaude, sessionId: 'session-b' } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'live-session',
      claudeProcessId: otherClaude,
      sessionId: 'session-b',
    })
  })

  it("never kills a process under another live instance, even one carrying the sweeper's marker", () => {
    const table = snapshot(
      {
        100: { started: 0, command: 'claude' },
        200: { started: 0, command: 'claude' },
        500: { parent: 200, started: 10 * SECOND },
      },
      { 500: { claudeProcessId: sweeper } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'live-session',
      claudeProcessId: otherClaude,
    })
  })

  it('gives a process the marker of its nearest marked ancestor', () => {
    const table = snapshot(
      {
        400: { started: 5 * SECOND },
        450: { parent: 400, started: 6 * SECOND },
        500: { parent: 450, started: 10 * SECOND, command: 'next-server (v15.0.0)' },
      },
      {
        400: { claudeProcessId: 300 },
        450: { claudeProcessId: otherClaude, sessionId: 'session-b' },
      },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({
      kind: 'ended-session',
      claudeProcessId: otherClaude,
      sessionId: 'session-b',
    })
  })

  it('stops at pid 1 and survives a cycle in the parent links', () => {
    const table = snapshot(
      {
        400: { parent: 500, started: 5 * SECOND },
        500: { parent: 400, started: 10 * SECOND },
      },
      { 1: { claudeProcessId: otherClaude } },
    )
    expect(classifyOwnership(candidate, table, sweeper)).toEqual({ kind: 'unmarked' })
    expect(
      classifyOwnership(
        candidate,
        snapshot({ 500: { started: 10 * SECOND } }, { 1: { claudeProcessId: sweeper } }),
        sweeper,
      ),
    ).toEqual({ kind: 'unmarked' })
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

describe('processesFromPsOutput', () => {
  it('parses parents, UTC start times at whole-second resolution, and commands', () => {
    const output = [
      '    1     0 Mon Aug 31 21:25:36 2026 /sbin/launchd',
      '96511 95549 Tue Oct  6 16:10:35 2026 claude --resume   ',
      '',
    ].join('\n')
    expect(processesFromPsOutput(output)).toEqual(
      new Map([
        [
          1,
          {
            parentProcessId: 0,
            started: Date.UTC(2026, 7, 31, 21, 25, 36),
            command: '/sbin/launchd',
          },
        ],
        [
          96511,
          {
            parentProcessId: 95549,
            started: Date.UTC(2026, 9, 6, 16, 10, 35),
            command: 'claude --resume',
          },
        ],
      ]),
    )
  })
})

describe('markerFromProcFile', () => {
  it('reads the marker from the NUL-separated environment', () => {
    expect(
      markerFromProcFile('PATH=/usr/bin\0CLAUDE_PID=42\0CLAUDE_CODE_SESSION_ID=abc\0'),
    ).toEqual({ claudeProcessId: 42, sessionId: 'abc' })
  })

  it('keeps the first of a repeated variable, as the process itself reads it', () => {
    expect(markerFromProcFile('CLAUDE_PID=1\0CLAUDE_PID=2\0')).toEqual({
      claudeProcessId: 1,
    })
  })

  it('reads no marker from an environment without a well-formed one', () => {
    expect(markerFromProcFile('PATH=/usr/bin\0')).toBeUndefined()
    for (const marker of ['', '0', '-4', '12abc']) {
      expect(markerFromProcFile(`CLAUDE_PID=${marker}\0`)).toBeUndefined()
    }
  })
})

describe('markersFromPsOutput', () => {
  it('reads the markers in what the environment listing adds after each command line', () => {
    const commands = [
      '  500 node server.js --port 3000',
      '  600 /bin/sleep 100',
      '  700 node worker.js',
      '',
    ].join('\n')
    const withEnvironments = [
      '  500 node server.js --port 3000 PATH=/usr/bin CLAUDE_PID=42 CLAUDE_CODE_SESSION_ID=abc HOME=/Users/dev',
      '  600 /bin/sleep 100',
      '  700 node worker.js PATH=/usr/bin HOME=/Users/dev',
      '',
    ].join('\n')
    expect(markersFromPsOutput(commands, withEnvironments)).toEqual(
      new Map([[500, { claudeProcessId: 42, sessionId: 'abc' }]]),
    )
  })

  it('does not mistake an argument for an environment variable', () => {
    const commands = '  500 env-runner CLAUDE_PID=99\n'
    const withEnvironments = '  500 env-runner CLAUDE_PID=99 CLAUDE_PID=42\n'
    expect(markersFromPsOutput(commands, withEnvironments).get(500)).toEqual({
      claudeProcessId: 42,
    })
  })

  it('reads the marker exactly, whatever entry follows it', () => {
    const commands = '  500 node server.js\n'
    const withEnvironments =
      '  500 node server.js PATH=/usr/bin CLAUDE_PID=42 BASH_FUNC_f%%=() { echo; } CLAUDE_CODE_SESSION_ID=abc\n'
    expect(markersFromPsOutput(commands, withEnvironments).get(500)).toEqual({
      claudeProcessId: 42,
      sessionId: 'abc',
    })
  })

  it("reads no marker when another variable's value holds a conflicting one", () => {
    const commands = '  500 node server.js\n'
    const withEnvironments = [
      '  500 node server.js PROMPT=echo CLAUDE_PID=7 CLAUDE_PID=42 HOME=/Users/dev',
      '',
    ].join('\n')
    expect(markersFromPsOutput(commands, withEnvironments).get(500)).toBeUndefined()
  })

  it('reads nothing for a process that exited between the two listings', () => {
    expect(markersFromPsOutput('  500 node a\n', '')).toEqual(new Map())
  })
})
