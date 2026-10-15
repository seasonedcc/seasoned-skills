import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'
import { openRecord, writeEntry } from '../../src/ledger/record.js'

const SESSION = '11111111-1111-4111-8111-111111111111'

const OTHER_SESSION = '22222222-2222-4222-8222-222222222222'

const STAMP = /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d\d:\d\d/

const commandLine = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url))

const typescriptSourceLoader = fileURLToPath(
  new URL('./typescript-source-loader.mjs', import.meta.url),
)

function run(...args: string[]) {
  return buildProgram().parseAsync(args, { from: 'user' })
}

function printed() {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => call.join(' '))
    .join('\n')
}

function complaints() {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => call.join(' '))
    .join('\n')
}

const realStdin = Object.getOwnPropertyDescriptor(process, 'stdin') as PropertyDescriptor

/** Standard input as a heredoc delivers it, or as a terminal. */
function stdin(text: string, terminal = false) {
  Object.defineProperty(process, 'stdin', {
    value: Object.assign(Readable.from([text]), { isTTY: terminal }),
    configurable: true,
  })
}

describe('the ledger commands', () => {
  let root: string
  let sessions: string
  let projects: string
  const startDirectory = process.cwd()

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-ledger-cli-'))
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    process.chdir(root)
    sessions = join(realpathSync(root), '.sessions')
    projects = join(root, 'claude-config', 'projects')
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude-config'))
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', SESSION)
    vi.stubEnv('TZ', 'America/Sao_Paulo')
    stdin('')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.chdir(startDirectory)
    process.exitCode = undefined
    Object.defineProperty(process, 'stdin', realStdin)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  function recordOf(sessionId = SESSION) {
    return join(sessions, sessionId, 'ledger.db')
  }

  async function write(text: string, ...args: string[]) {
    stdin(text)
    await run('ledger', ...args)
  }

  async function decide(text: string, ...extra: string[]) {
    await write(text, 'decision', '--as', 'orchestrator', '--by', 'person', ...extra)
  }

  async function learn(text: string, ...extra: string[]) {
    await write(text, 'finding', '--as', 'researcher', '--source', 'src/a.ts:1', ...extra)
  }

  function freshOutput() {
    vi.mocked(console.log).mockClear()
    vi.mocked(console.error).mockClear()
  }

  /** The real command line in its own process, its standard input arriving after a pause. */
  function ledgerInChildProcess(args: string[], input: string, pause = 0) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          [
            '--experimental-transform-types',
            '--no-warnings',
            '--import',
            typescriptSourceLoader,
            commandLine,
            'ledger',
            ...args,
          ],
          { cwd: root, env: { ...process.env } },
        )
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => {
          stdout += chunk
        })
        child.stderr.on('data', (chunk) => {
          stderr += chunk
        })
        child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr }))
        setTimeout(() => child.stdin.end(input), pause)
      },
    )
  }

  function writeInChildProcess(index: number) {
    return ledgerInChildProcess(
      ['finding', '--as', `writer-${index}`, '--source', 'a concurrent test'],
      `Concurrent write number ${index}.\n`,
    )
  }

  describe('writing', () => {
    it("answers with the entry's number, kind, and local time, and nothing else", async () => {
      await decide('Every agent writes to the same record.\n')
      expect(process.exitCode).toBeUndefined()
      expect(vi.mocked(console.log).mock.calls).toHaveLength(1)
      expect(printed()).toMatch(/^#1 decision, \d{4}-\d\d-\d\d \d\d:\d\d:\d\d -03:00$/)
      expect(existsSync(recordOf())).toBe(true)
    })

    it('stores the text exactly as it arrives, less the one trailing newline', async () => {
      const text = '  $(rm -rf /) and `backticks`\n\nENTRY-like line\n\n'
      await learn(text)
      freshOutput()
      await run('ledger', 'show', '1')
      expect(printed().endsWith(`\n\n${text.slice(0, -1)}`)).toBe(true)
    })

    it('creates the session folder through session-folder, recording the projects directory', async () => {
      mkdirSync(join(projects, '-project'), { recursive: true })
      writeFileSync(join(projects, '-project', `${SESSION}.jsonl`), '{}\n')
      await learn('A fact.\n')
      expect(readFileSync(join(sessions, SESSION, '.projects'), 'utf8')).toBe(
        `${projects}\n`,
      )
    })

    it('refuses empty or whitespace-only text, and a terminal, writing nothing', async () => {
      for (const text of ['', '\n', '  \n\t\n']) {
        await decide(text)
        expect(complaints()).toContain(
          "The entry has no text: end the command with <<'ENTRY'",
        )
      }
      stdin('Never read.\n', true)
      await run('ledger', 'decision', '--as', 'orchestrator', '--by', 'person')
      expect(complaints()).toContain("The entry's text comes on standard input")
      expect(process.exitCode).toBe(1)
      expect(existsSync(recordOf())).toBe(false)
    })

    it('waits for text that arrives after the command has started', {
      timeout: 60_000,
    }, async () => {
      const result = await ledgerInChildProcess(
        ['progress', '--as', 'orchestrator'],
        'Slow text.\n',
        1500,
      )
      expect(result).toMatchObject({ code: 0, stderr: '' })
      expect(result.stdout).toMatch(/^#1 progress, /)
    })

    it('requires a writer on every write', async () => {
      for (const args of [
        ['decision', '--by', 'person'],
        ['finding', '--source', 'here'],
        ['progress'],
        ['progress', '--as', '  '],
      ]) {
        freshOutput()
        await write('Text.\n', ...args)
        expect(complaints()).toBe(
          "Every ledger write names its writer with --as: orchestrator, or the subagent's task name.",
        )
      }
      expect(existsSync(recordOf())).toBe(false)
    })

    it('keeps decisions and progress to the orchestrator, and takes findings from anyone', async () => {
      await write('A rule.\n', 'decision', '--as', 'lane-a', '--by', 'agent')
      expect(complaints()).toContain('Only the orchestrator records decisions')
      freshOutput()
      await write('Launched.\n', 'progress', '--as', 'lane-a')
      expect(complaints()).toContain('Only the orchestrator records progress')
      expect(existsSync(recordOf())).toBe(false)

      process.exitCode = undefined
      await write('A fact.\n', 'finding', '--as', 'lane-a', '--source', 'probe')
      await write('Launched.\n', 'progress', '--as', 'orchestrator')
      expect(process.exitCode).toBeUndefined()
      expect(printed()).toMatch(/^#1 finding, .*\n#2 progress, /)
    })

    it('lets any writer replace a finding, by its number with or without #', async () => {
      await learn('The hook fires for subagents.\n')
      await write(
        'It fires only for the orchestrator.\n',
        'finding',
        '--as',
        'lane-b',
        '--source',
        'docs',
        '--replaces',
        '#1',
      )
      await write(
        'Checked: it fires for both.\n',
        'finding',
        '--as',
        'orchestrator',
        '--source',
        'a live run',
        '--replaces',
        '2',
      )
      expect(process.exitCode).toBeUndefined()
      freshOutput()
      await run('ledger', 'show', '#2')
      expect(printed()).toContain(
        'Replacement line, oldest first: #1 → #2 (this entry) → #3',
      )
    })

    it('requires who decided a decision and where a finding came from', async () => {
      await write('A rule.\n', 'decision', '--as', 'orchestrator')
      expect(complaints()).toBe(
        'A decision says who decided it: --by person or --by agent.',
      )
      freshOutput()
      await write('A rule.\n', 'decision', '--as', 'orchestrator', '--by', 'committee')
      expect(complaints()).toBe(
        'A decision says who decided it: --by person or --by agent.',
      )
      freshOutput()
      await write('A fact.\n', 'finding', '--as', 'lane-a', '--source', ' ')
      expect(complaints()).toContain(
        'A finding says where it came from: --source <where>',
      )
      expect(existsSync(recordOf())).toBe(false)
    })

    it("passes the database's refusals on as they are", async () => {
      await write('Launched.\n', 'progress', '--as', 'orchestrator')
      await decide('A rule.\n', '--replaces', '1')
      expect(complaints()).toBe('That entry is progress, and progress is never replaced.')
      freshOutput()
      await decide('A rule.\n', '--replaces', 'forty-seven')
      expect(complaints()).toBe("--replaces takes an entry's number, such as 47.")
      expect(process.exitCode).toBe(1)
    })

    it('fails outside a Claude Code session the way session-folder does', async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', '')
      await decide('A rule.\n')
      expect(complaints()).toBe(
        'CLAUDE_CODE_SESSION_ID is not set — a session folder belongs to a Claude Code session, so ask for it from inside one.',
      )
      expect(existsSync(sessions)).toBe(false)
    })

    it("refuses ledger's own --session or --hook before a subcommand", async () => {
      await write(
        'A rule.\n',
        '--session',
        OTHER_SESSION,
        'decision',
        '--as',
        'orchestrator',
        '--by',
        'person',
      )
      expect(complaints()).toContain('--session before a subcommand would be ignored')
      freshOutput()
      await write('A rule.\n', '--hook', 'progress', '--as', 'orchestrator')
      expect(complaints()).toContain("--hook is the compaction hook's mode")
      freshOutput()
      await run('ledger', '--session', OTHER_SESSION, 'print')
      expect(complaints()).toContain('--session before a subcommand would be ignored')
      expect(process.exitCode).toBe(1)
      expect(existsSync(sessions)).toBe(false)
    })

    it('records every entry when several processes write at once', {
      timeout: 60_000,
    }, async () => {
      const writers = Array.from({ length: 8 }, (_, index) => writeInChildProcess(index))
      const results = await Promise.all(writers)
      for (const result of results) {
        expect(result).toMatchObject({ code: 0, stderr: '' })
        expect(result.stdout).toMatch(/^#\d+ finding, /)
      }
      const numbers = results.map((result) => Number(result.stdout.match(/^#(\d+)/)?.[1]))
      expect(numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      await run('ledger', 'search', 'concurrent')
      expect(printed()).toContain('#8 finding')
      expect(printed()).toContain('#1 finding')
    })

    it('makes every writer wait for a write another connection holds open', {
      timeout: 60_000,
    }, async () => {
      mkdirSync(join(sessions, SESSION), { recursive: true })
      const holder = await openRecord(recordOf())
      holder.exec('BEGIN IMMEDIATE')
      const writers = Array.from({ length: 4 }, (_, index) => writeInChildProcess(index))
      await delay(2000)
      holder.exec('COMMIT')
      holder.close()
      const results = await Promise.all(writers)
      expect(results.map((result) => result.stderr)).toEqual(['', '', '', ''])
      expect(results.map((result) => result.code)).toEqual([0, 0, 0, 0])
    })
  })

  describe('reading', () => {
    it('says there is no ledger yet, creating nothing', async () => {
      for (const args of [[], ['search', 'anything'], ['show', '1'], ['print']]) {
        freshOutput()
        await run('ledger', ...args)
        expect(printed()).toBe('No ledger yet in this session.')
      }
      freshOutput()
      await run('ledger', '--session', OTHER_SESSION)
      expect(printed()).toBe('No ledger yet in this session.')
      expect(process.exitCode).toBeUndefined()
      expect(existsSync(sessions)).toBe(false)
    })

    it('prints what is in force: decisions newest first, the latest progress, and a findings count', async () => {
      await decide('Use a file.\n')
      await decide('Use a database.\n', '--replaces', '1')
      await write(
        'Every agent writes.\n',
        'decision',
        '--as',
        'orchestrator',
        '--by',
        'agent',
      )
      await learn('A fact.\n')
      await learn('A corrected fact.\n', '--replaces', '4')
      await learn('Another fact.\n')
      for (let step = 1; step <= 12; step += 1) {
        await write(`Step ${step}.\n`, 'progress', '--as', 'orchestrator')
      }
      freshOutput()
      await run('ledger')
      const lines = printed().split('\n')
      expect(lines[0]).toBe('In force: 2 decisions, newest first')
      expect(lines[1]).toMatch(
        /^ {2}#3 {2}agent {2}orchestrator {2}\d\d:\d\d {2}Every agent writes\.$/,
      )
      expect(lines[2]).toMatch(
        /^ {2}#2 {2}person {2}orchestrator {2}\d\d:\d\d {2}Use a database\.$/,
      )
      expect(lines[3]).toBe('Latest progress: 10 of 12, newest first')
      expect(lines[4]).toMatch(/ {2}Step 12\.$/)
      expect(lines[13]).toMatch(/ {2}Step 3\.$/)
      expect(lines[14]).toBe(
        'Findings: 2 in force, 1 replaced. Search them with: pnpm exec seasoned-skills ledger search <words>',
      )
      expect(lines).toHaveLength(15)
      expect(printed()).not.toContain('Use a file.')
    })

    it('searches, shows, and prints, marking what was replaced', async () => {
      await learn('The sweep keeps folders without a projects file.\n')
      await write(
        'The sweep removes them after two reads.\n',
        'finding',
        '--as',
        'lane-a',
        '--source',
        'src/sessions/folders.ts:199',
        '--replaces',
        '1',
      )
      freshOutput()
      await run('ledger', 'search', 'sweep folders')
      expect(printed()).toMatch(
        /^#2 finding, written by lane-a, \d\d:\d\d\n {2}Source: src\/sessions\/folders\.ts:199\n {2}The sweep removes them after two reads\.\n\n#1 finding, written by researcher, \d\d:\d\d, replaced by #2\n {2}Source: src\/a\.ts:1\n {2}The sweep keeps folders without a projects file\.$/,
      )

      freshOutput()
      await run('ledger', 'show', '1')
      expect(printed()).toMatch(STAMP)
      expect(printed()).toContain('Replaced by #2')
      expect(printed()).toContain('Replacement line, oldest first: #1 (this entry) → #2')

      freshOutput()
      await run('ledger', 'print')
      expect(printed()).toContain(`Ledger of session ${SESSION}: 2 entries, oldest first`)
      expect(printed()).toContain('Replaced by #2')
      expect(printed()).toContain('Replaces #1')

      freshOutput()
      await run('ledger', 'show', '9')
      expect(complaints()).toBe("There is no entry #9 in this session's ledger.")
      expect(process.exitCode).toBe(1)
    })

    it("reads another session's record with --session, after the subcommand", async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', OTHER_SESSION)
      await learn('Yesterday it worked.\n')
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', SESSION)
      await learn('Today it fails.\n')
      freshOutput()
      await run('ledger', 'search', 'worked', 'fails', '--session', OTHER_SESSION)
      expect(printed()).toContain('Yesterday it worked.')
      expect(printed()).not.toContain('Today it fails.')
      freshOutput()
      await run('ledger', 'print', '--session', OTHER_SESSION)
      expect(printed()).toContain(`Ledger of session ${OTHER_SESSION}: 1 entry`)
    })

    it('refuses a --session that is not a session id, creating nothing', async () => {
      await run('ledger', 'print', '--session', '../escape')
      expect(complaints()).toBe(
        '"../escape" is not a Claude Code session id, so no session folder is named after it.',
      )
      expect(process.exitCode).toBe(1)
      expect(readdirSync(root).filter((name) => name !== '.git')).toEqual([])
    })

    it('needs --session outside a Claude Code session', async () => {
      for (const unset of [undefined, '']) {
        freshOutput()
        vi.stubEnv('CLAUDE_CODE_SESSION_ID', unset)
        await run('ledger')
        expect(complaints()).toContain('or name the session with --session <id>')
      }
      expect(process.exitCode).toBe(1)
    })

    it('shows only what is in force on a record of thousands of entries, and at most 20 matches', async () => {
      mkdirSync(join(sessions, SESSION), { recursive: true })
      const database = await openRecord(recordOf())
      database.exec('BEGIN')
      let latestRule = 0
      for (let index = 0; index < 1000; index += 1) {
        latestRule = writeEntry(database, {
          kind: 'decision',
          body: `rule ${index}`,
          writtenBy: 'orchestrator',
          decidedBy: 'person',
          ...(index % 25 === 0 ? {} : { replaces: latestRule }),
        }).id
        const fact = writeEntry(database, {
          kind: 'finding',
          body: `fact ${index}`,
          writtenBy: 'researcher',
          source: 'probe',
        })
        if (index % 2 === 0) {
          writeEntry(database, {
            kind: 'finding',
            body: `fact ${index} corrected`,
            writtenBy: 'researcher',
            source: 'probe',
            replaces: fact.id,
          })
        }
        writeEntry(database, {
          kind: 'progress',
          body: `step ${index}`,
          writtenBy: 'orchestrator',
        })
      }
      database.exec('COMMIT')
      database.close()

      await run('ledger')
      const lines = printed().split('\n')
      expect(lines[0]).toBe('In force: 40 decisions, newest first')
      const rules = lines.filter((line) => /^ {2}#\d+ {2}person/.test(line))
      expect(rules.map((line) => line.split('  ').at(-1))).toEqual(
        Array.from({ length: 40 }, (_, group) => `rule ${999 - group * 25}`),
      )
      expect(lines.filter((line) => line.includes('  step '))).toHaveLength(10)
      expect(lines.at(-1)).toContain('Findings: 1000 in force, 500 replaced.')
      expect(lines).toHaveLength(53)

      freshOutput()
      await run('ledger', 'search', 'fact')
      expect(printed().match(/^#\d+ finding/gm)).toHaveLength(20)
      expect(printed().endsWith('1480 more not shown')).toBe(true)
    })
  })

  describe('on a Node whose SQLite cannot hold the ledger', () => {
    const NEEDS_NODE = 'The ledger needs Node 22.16 or later.'

    function withoutSqlite(): never {
      throw new Error('No such built-in module: node:sqlite')
    }

    async function withoutFullTextSearch() {
      const actual = await vi.importActual<typeof import('node:sqlite')>('node:sqlite')
      class DatabaseSync extends actual.DatabaseSync {
        exec(sql: string) {
          if (/\bfts5\b/i.test(sql)) throw new Error('no such module: fts5')
          super.exec(sql)
        }
      }
      return { ...actual, DatabaseSync }
    }

    afterEach(() => {
      vi.doUnmock('node:sqlite')
    })

    for (const [node, sqlite] of [
      ['without node:sqlite', withoutSqlite],
      ['whose node:sqlite lacks FTS5', withoutFullTextSearch],
    ] as const) {
      it(`refuses every ledger command on a Node ${node}, creating nothing`, async () => {
        vi.doMock('node:sqlite', sqlite)
        for (const args of [
          ['decision', '--as', 'orchestrator', '--by', 'person'],
          ['finding', '--as', 'researcher', '--source', 'probe'],
          ['progress', '--as', 'orchestrator'],
          [],
          ['search', 'anything'],
          ['show', '1'],
          ['print'],
        ]) {
          freshOutput()
          process.exitCode = undefined
          await write('Text.\n', ...args)
          expect(complaints()).toBe(NEEDS_NODE)
          expect(printed()).toBe('')
          expect(process.exitCode).toBe(1)
        }
        expect(existsSync(sessions)).toBe(false)
      })
    }

    it('keeps the compaction hook silent and every other command working', async () => {
      await decide('The person decided this.\n')
      freshOutput()
      vi.doMock('node:sqlite', withoutFullTextSearch)
      stdin(JSON.stringify({ session_id: SESSION }))
      await run('ledger', '--hook')
      expect(printed()).toBe('')
      vi.doMock('node:sqlite', withoutSqlite)
      await run('ledger', '--hook')
      expect(printed()).toBe('')
      await run('session-folder')
      expect(printed()).toBe(join(sessions, SESSION))
      expect(process.exitCode).toBeUndefined()
    })
  })

  describe('as the compaction hook', () => {
    function hookPayload(payload: string) {
      stdin(payload)
      return run('ledger', '--hook')
    }

    it('prints the fitted in-force view of the session the payload names', async () => {
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', OTHER_SESSION)
      await decide('The person decided this.\n')
      vi.stubEnv('CLAUDE_CODE_SESSION_ID', undefined)
      freshOutput()
      await hookPayload(JSON.stringify({ session_id: OTHER_SESSION, source: 'compact' }))
      expect(printed()).toContain('The person decided this.')
      expect(process.exitCode).toBeUndefined()
    })

    it("fits a view longer than Claude Code's 10,000-character cap under 9,500 characters", async () => {
      mkdirSync(join(sessions, SESSION), { recursive: true })
      const database = await openRecord(recordOf())
      database.exec('BEGIN')
      for (let index = 0; index < 150; index += 1) {
        writeEntry(database, {
          kind: 'decision',
          body: `Decision number ${index}, ${'worded at some length, '.repeat(3)}`,
          writtenBy: 'orchestrator',
          decidedBy: 'person',
        })
      }
      database.exec('COMMIT')
      database.close()
      await run('ledger')
      expect(`${printed()}\n`.length).toBeGreaterThan(10_000)

      freshOutput()
      await hookPayload(JSON.stringify({ session_id: SESSION }))
      const hookText = `${printed()}\n`
      expect(hookText.length).toBeLessThanOrEqual(9_500)
      expect(hookText).toMatch(
        /\n\d+ older decisions in force: run `pnpm exec seasoned-skills ledger`\n/,
      )
      expect(hookText).toContain('Decision number 149,')
    })

    it('waits for a payload that arrives after the hook has started', {
      timeout: 60_000,
    }, async () => {
      await decide('The person decided this.\n')
      const result = await ledgerInChildProcess(
        ['--hook'],
        JSON.stringify({ session_id: SESSION }),
        1500,
      )
      expect(result).toMatchObject({ code: 0, stderr: '' })
      expect(result.stdout).toContain('The person decided this.')
    })

    it('prints nothing and never fails without a record, a valid payload, or a valid id', async () => {
      for (const payload of [
        JSON.stringify({ session_id: SESSION }),
        '{not json',
        JSON.stringify({ session_id: '../escape' }),
        JSON.stringify({}),
      ]) {
        await hookPayload(payload)
      }
      stdin('', true)
      await run('ledger', '--hook')
      expect(vi.mocked(console.log)).not.toHaveBeenCalled()
      expect(vi.mocked(console.error)).not.toHaveBeenCalled()
      expect(process.exitCode).toBeUndefined()
      expect(existsSync(sessions)).toBe(false)
    })
  })
})
