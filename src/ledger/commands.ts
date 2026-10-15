import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Command } from 'commander'
import {
  claudeCodeSessionId,
  claudeProjectsDirectory,
  sessionFolder,
  sessionFolderPath,
} from '../sessions/folders.js'
import {
  allEntries,
  decisionsInForce,
  entryById,
  findingCounts,
  latestProgress,
  loadSqlite,
  type NewEntry,
  openExistingRecord,
  openRecord,
  replacementLine,
  searchEntries,
  writeEntry,
} from './record.js'
import {
  entryReport,
  fittedInForceView,
  inForceView,
  recordText,
  searchReport,
  writeAnswer,
} from './views.js'

const RECORD_FILE = 'ledger.db'

const NO_RECORD = 'No ledger yet in this session.'

const LATEST_PROGRESS = 10

const ORCHESTRATOR = 'orchestrator'

const HEREDOC =
  "end the command with <<'ENTRY', then the text, then a line that is exactly ENTRY"

interface WriteOptions {
  as?: string
  replaces?: string
}

function refuse(message: string): never {
  throw new Error(message)
}

/**
 * Run a ledger command, printing why it cannot when it cannot. A Node whose
 * SQLite cannot hold the ledger is refused before anything is created.
 */
async function reporting(work: () => Promise<void>) {
  try {
    await loadSqlite()
    await work()
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}

/** The entry's text from standard input, less the one trailing newline a heredoc adds. */
function entryText() {
  if (process.stdin.isTTY) {
    refuse(
      `The entry's text comes on standard input, through a quoted heredoc: ${HEREDOC}.`,
    )
  }
  const text = readFileSync(0, 'utf8')
  if (text.trim() === '') refuse(`The entry has no text: ${HEREDOC}.`)
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

function writer(options: WriteOptions) {
  const name = options.as?.trim()
  if (name === undefined || name === '') {
    refuse(
      `Every ledger write names its writer with --as: ${ORCHESTRATOR}, or the subagent's task name.`,
    )
  }
  return name
}

function orchestratorOnly(options: WriteOptions, kind: string) {
  const name = writer(options)
  if (name !== ORCHESTRATOR) {
    refuse(
      `Only the orchestrator records ${kind}; a subagent records what it learned with \`pnpm exec seasoned-skills ledger finding\`.`,
    )
  }
  return name
}

function entryNumber(value: string, flag: string) {
  const number = value.match(/^#?(\d+)$/)?.[1]
  if (number === undefined) refuse(`${flag} takes an entry's number, such as 47.`)
  return Number(number)
}

function replaced(options: WriteOptions) {
  return options.replaces === undefined
    ? {}
    : { replaces: entryNumber(options.replaces, '--replaces') }
}

/**
 * Refuse `ledger`'s own --session or --hook given before a subcommand, which
 * would ignore it: a write would record into the current session unnoticed.
 */
function refuseLedgerOptions(ledger: Command) {
  const { session, hook } = ledger.opts<{ session?: string; hook?: boolean }>()
  if (session !== undefined) {
    refuse(
      '--session before a subcommand would be ignored. A read takes its own --session after its name, such as `pnpm exec seasoned-skills ledger search <words> --session <id>`, and a write never takes one.',
    )
  }
  if (hook) refuse("--hook is the compaction hook's mode of `ledger` alone.")
}

async function write(entry: NewEntry) {
  const folder = sessionFolder(
    process.cwd(),
    process.env.CLAUDE_CODE_SESSION_ID,
    claudeProjectsDirectory(process.env),
  )
  const database = await openRecord(join(folder.path, RECORD_FILE))
  try {
    console.log(writeAnswer(writeEntry(database, entry)))
  } finally {
    database.close()
  }
}

/** The session a read names with --session, or the current one. */
function sessionToRead(session: string | undefined) {
  if (session !== undefined) return session
  const current = process.env.CLAUDE_CODE_SESSION_ID
  if (current === undefined || current === '') {
    refuse(
      'CLAUDE_CODE_SESSION_ID is not set — the ledger belongs to a Claude Code session, so read it from inside one, or name the session with --session <id>.',
    )
  }
  return claudeCodeSessionId(current)
}

function recordPathOf(sessionId: string) {
  return join(sessionFolderPath(process.cwd(), sessionId), RECORD_FILE)
}

async function read(
  session: string | undefined,
  report: (database: DatabaseSync, sessionId: string) => string,
) {
  const sessionId = sessionToRead(session)
  const database = await openExistingRecord(recordPathOf(sessionId))
  if (database === undefined) {
    console.log(NO_RECORD)
    return
  }
  try {
    console.log(report(database, sessionId))
  } finally {
    database.close()
  }
}

function inForce(database: DatabaseSync) {
  return {
    decisions: decisionsInForce(database),
    progress: latestProgress(database, LATEST_PROGRESS),
    findings: findingCounts(database),
    now: new Date(),
  }
}

/** The session the compaction hook's payload names, or nothing. */
function hookSession() {
  if (process.stdin.isTTY) return undefined
  const payload = JSON.parse(readFileSync(0, 'utf8')) as { session_id?: unknown }
  return typeof payload.session_id === 'string' ? payload.session_id : undefined
}

/** The compaction hook: the fitted in-force view, or nothing. Never fails. */
async function runHook() {
  try {
    const sessionId = hookSession()
    if (sessionId === undefined) return
    const database = await openExistingRecord(recordPathOf(sessionId))
    if (database === undefined) return
    try {
      console.log(fittedInForceView(inForce(database)))
    } finally {
      database.close()
    }
  } catch {}
}

/** The `ledger` command and its subcommands, declared on the program. */
function declareLedger(program: Command) {
  const ledger = program
    .command('ledger')
    .description(
      "Keep this Claude Code session's ledger: a record in the session folder that accepts new entries — decisions, findings, and progress — and refuses every edit and every delete. On its own it prints what is in force: the decisions no later entry replaced, the latest progress, and a count of the findings.",
    )
    .enablePositionalOptions()
    .option(
      '--session <id>',
      "read that session's record instead of the current one's, by its session id",
    )
    .option(
      '--hook',
      "run as the compaction hook: read the session from the hook payload on stdin, print the in-force view fitted under the hook's budget, print nothing without a record, and always exit 0",
    )
    .action(async (options: { session?: string; hook?: boolean }) => {
      if (options.hook) {
        await runHook()
        return
      }
      await reporting(() =>
        read(options.session, (database) => inForceView(inForce(database))),
      )
    })

  ledger
    .command('decision')
    .description(
      "Record something that now governs the work, with its text on stdin through <<'ENTRY'. The orchestrator's alone.",
    )
    .option('--as <writer>', `who is writing: always ${ORCHESTRATOR} for a decision`)
    .option('--by <who>', 'who decided it: person or agent')
    .option('--replaces <number>', 'the decision this one replaces, by its number')
    .action(async (options: WriteOptions & { by?: string }) => {
      await reporting(async () => {
        refuseLedgerOptions(ledger)
        const writtenBy = orchestratorOnly(options, 'decisions')
        const decidedBy = options.by
        if (decidedBy !== 'person' && decidedBy !== 'agent') {
          refuse('A decision says who decided it: --by person or --by agent.')
        }
        await write({
          kind: 'decision',
          body: entryText(),
          writtenBy,
          decidedBy,
          ...replaced(options),
        })
      })
    })

  ledger
    .command('finding')
    .description(
      "Record something learned about the product, with where it came from, with its text on stdin through <<'ENTRY'. Any writer, subagents included.",
    )
    .option(
      '--as <writer>',
      `who is writing: ${ORCHESTRATOR}, or the subagent's task name`,
    )
    .option(
      '--source <where>',
      'where it came from: a file and line, a command and what it printed, a page, a test',
    )
    .option('--replaces <number>', 'the finding this one replaces, by its number')
    .action(async (options: WriteOptions & { source?: string }) => {
      await reporting(async () => {
        refuseLedgerOptions(ledger)
        const writtenBy = writer(options)
        const source = options.source
        if (source === undefined || source.trim() === '') {
          refuse(
            'A finding says where it came from: --source <where>, such as a file and line, a command and what it printed, a page, or a test.',
          )
        }
        await write({
          kind: 'finding',
          body: entryText(),
          writtenBy,
          source,
          ...replaced(options),
        })
      })
    })

  ledger
    .command('progress')
    .description(
      "Record where the work stands, once its result has been read, with its text on stdin through <<'ENTRY'. The orchestrator's alone.",
    )
    .option('--as <writer>', `who is writing: always ${ORCHESTRATOR} for progress`)
    .action(async (options: WriteOptions) => {
      await reporting(async () => {
        refuseLedgerOptions(ledger)
        const writtenBy = orchestratorOnly(options, 'progress')
        await write({ kind: 'progress', body: entryText(), writtenBy })
      })
    })

  ledger
    .command('search')
    .description(
      'Search every entry, in force or not, for any of the words: the best 20 matches, ordered by how many of the words each matches, then newest first.',
    )
    .argument('<words...>', 'plain words, each matched on its own')
    .option('--session <id>', "search that session's record instead of the current one's")
    .action(async (words: string[], options: { session?: string }) => {
      await reporting(async () => {
        refuseLedgerOptions(ledger)
        await read(options.session, (database) =>
          searchReport(searchEntries(database, words), new Date()),
        )
      })
    })

  ledger
    .command('show')
    .description(
      'Print one entry whole, with its source and its line of replacements both ways.',
    )
    .argument('<number>', "the entry's number, with or without a leading #")
    .option('--session <id>', "read that session's record instead of the current one's")
    .action(async (value: string, options: { session?: string }) => {
      await reporting(async () => {
        refuseLedgerOptions(ledger)
        const id = entryNumber(value, 'show')
        await read(options.session, (database) => {
          const entry = entryById(database, id)
          if (entry === undefined)
            refuse(`There is no entry #${id} in this session's ledger.`)
          return entryReport(entry, replacementLine(database, id))
        })
      })
    })

  ledger
    .command('print')
    .description(
      'Print the whole record as plain text, oldest first, each replaced entry saying what replaced it.',
    )
    .option('--session <id>', "print that session's record instead of the current one's")
    .action(async (options: { session?: string }) => {
      await reporting(async () => {
        refuseLedgerOptions(ledger)
        await read(options.session, (database, sessionId) =>
          recordText(sessionId, allEntries(database)),
        )
      })
    })
}

export { declareLedger }
