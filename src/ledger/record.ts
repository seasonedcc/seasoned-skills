import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * The ledger's record: one SQLite database per session, which accepts new
 * entries and refuses every edit and every delete on its own, whoever asks.
 * A decision or a finding is in force until a later entry of its own kind
 * replaces it; progress is never replaced. The search index is derived from
 * the entries and is the one part a stray command can empty, so every search
 * checks it first, unless another connection holds a write open, and rebuilds
 * it when it fails.
 */

type EntryKind = 'decision' | 'finding' | 'progress'

type DecidedBy = 'person' | 'agent'

interface Entry {
  id: number
  kind: EntryKind
  body: string
  decidedBy: DecidedBy | null
  source: string | null
  writtenBy: string
  replaces: number | null
  replacedBy: number | null
  writtenAt: Date
}

type NewEntry =
  | {
      kind: 'decision'
      body: string
      writtenBy: string
      decidedBy: DecidedBy
      replaces?: number
    }
  | {
      kind: 'finding'
      body: string
      writtenBy: string
      source: string
      replaces?: number
    }
  | { kind: 'progress'; body: string; writtenBy: string }

interface SearchResults {
  matches: (Entry & { excerpt: string })[]
  total: number
}

const SEARCH_LIMIT = 20

const BUSY_TIMEOUT = 5000

const SQLITE_BUSY = 5

const SQLITE_CORRUPT_VTAB = 267

const ALREADY_REPLACED =
  'That entry was already replaced: replace the entry in force in its place instead.'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    id integer PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('decision', 'finding', 'progress')),
    body text NOT NULL CHECK (trim(body, char(32, 9, 10, 13)) <> ''),
    decided_by text CHECK (decided_by IN ('person', 'agent')),
    source text CHECK (trim(source, char(32, 9, 10, 13)) <> ''),
    written_by text NOT NULL CHECK (trim(written_by, char(32, 9, 10, 13)) <> ''),
    replaces integer REFERENCES entries (id),
    written_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK ((kind = 'decision') = (decided_by IS NOT NULL)),
    CHECK ((kind = 'finding') = (source IS NOT NULL))
  ) STRICT;

  CREATE INDEX IF NOT EXISTS entries_by_replaces ON entries (replaces);

  CREATE TRIGGER IF NOT EXISTS entries_are_never_edited
  BEFORE UPDATE ON entries
  BEGIN
    SELECT RAISE(ABORT, 'Ledger entries are never edited: each one stays exactly as it was written. Record a new entry instead.');
  END;

  CREATE TRIGGER IF NOT EXISTS entries_are_never_deleted
  BEFORE DELETE ON entries
  BEGIN
    SELECT RAISE(ABORT, 'Ledger entries are never deleted: each one stays exactly as it was written.');
  END;

  CREATE TRIGGER IF NOT EXISTS entries_are_never_overwritten
  BEFORE INSERT ON entries
  WHEN EXISTS (SELECT 1 FROM entries WHERE id = NEW.id)
  BEGIN
    SELECT RAISE(ABORT, 'Ledger entries are never overwritten: each one stays exactly as it was written.');
  END;

  CREATE TRIGGER IF NOT EXISTS replacements_replace_what_is_in_force
  BEFORE INSERT ON entries
  WHEN NEW.replaces IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'Progress is never replaced and never replaces anything.')
    WHERE NEW.kind = 'progress';
    SELECT RAISE(ABORT, 'There is no entry by that number to replace.')
    WHERE NOT EXISTS (SELECT 1 FROM entries WHERE id = NEW.replaces);
    SELECT RAISE(ABORT, 'That entry is progress, and progress is never replaced.')
    WHERE (SELECT kind FROM entries WHERE id = NEW.replaces) = 'progress';
    SELECT RAISE(ABORT, 'A decision replaces only a decision, and a finding only a finding.')
    WHERE (SELECT kind FROM entries WHERE id = NEW.replaces) <> NEW.kind;
    SELECT RAISE(ABORT, '${ALREADY_REPLACED}')
    WHERE EXISTS (SELECT 1 FROM entries WHERE replaces = NEW.replaces);
  END;

  CREATE VIEW IF NOT EXISTS entries_in_force AS
  SELECT * FROM entries
  WHERE kind IN ('decision', 'finding')
    AND NOT EXISTS (SELECT 1 FROM entries AS later WHERE later.replaces = entries.id);

  CREATE VIRTUAL TABLE IF NOT EXISTS entries_search USING fts5 (
    body,
    source,
    content = 'entries',
    content_rowid = 'id',
    tokenize = 'porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS entries_are_indexed
  AFTER INSERT ON entries
  BEGIN
    INSERT INTO entries_search (rowid, body, source) VALUES (NEW.id, NEW.body, NEW.source);
  END;
`

const ENTRY_COLUMNS = `
  entries.id,
  entries.kind,
  entries.body,
  entries.decided_by,
  entries.source,
  entries.written_by,
  entries.replaces,
  (SELECT later.id FROM entries AS later WHERE later.replaces = entries.id) AS replaced_by,
  entries.written_at
`

interface EntryRow {
  id: number
  kind: EntryKind
  body: string
  decided_by: DecidedBy | null
  source: string | null
  written_by: string
  replaces: number | null
  replaced_by: number | null
  written_at: string
}

/**
 * Node's SQLite, once it is known to hold the search index: before Node 22.13
 * `node:sqlite` needs a flag, and before 22.16 it comes without FTS5.
 */
async function loadSqlite() {
  try {
    const sqlite = await import('node:sqlite')
    const probe = new sqlite.DatabaseSync(':memory:')
    try {
      probe.exec('CREATE VIRTUAL TABLE probe USING fts5 (text)')
    } finally {
      probe.close()
    }
    return sqlite
  } catch {
    throw new Error('The ledger needs Node 22.16 or later.')
  }
}

/**
 * Switch the record to WAL, where reads never wait for a write. On a new file
 * the switch does not wait out the busy timeout while another connection holds
 * a write lock, so it is tried again until the timeout has passed.
 */
async function switchToWal(database: DatabaseSync, deadline: number): Promise<void> {
  try {
    database.exec('PRAGMA journal_mode = WAL')
  } catch (error) {
    if ((error as { errcode?: number }).errcode !== SQLITE_BUSY || Date.now() > deadline)
      throw error
    await delay(10)
    await switchToWal(database, deadline)
  }
}

async function connect(path: string) {
  const { DatabaseSync } = await loadSqlite()
  const database = new DatabaseSync(path)
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT}`)
  await switchToWal(database, Date.now() + BUSY_TIMEOUT)
  return database
}

/** The record at this path, created with its schema when it is not there yet. */
async function openRecord(path: string) {
  const database = await connect(path)
  inTransaction(database, () => database.exec(SCHEMA))
  return database
}

/** The record at this path, or nothing when no write has created it yet. Never creates one. */
async function openExistingRecord(path: string) {
  if (!existsSync(path)) return undefined
  const database = await connect(path)
  const created = database
    .prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'entries'`)
    .get()
  if (created === undefined) {
    database.close()
    return undefined
  }
  return database
}

function inTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function entryOf(row: EntryRow): Entry {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    decidedBy: row.decided_by,
    source: row.source,
    writtenBy: row.written_by,
    replaces: row.replaces,
    replacedBy: row.replaced_by,
    writtenAt: new Date(row.written_at),
  }
}

function entriesOf(rows: unknown[]): Entry[] {
  return (rows as EntryRow[]).map(entryOf)
}

/**
 * Record a new entry, stamped by the database's own clock. Replacing an entry
 * something already replaced is refused with the number of the one in force
 * in its place, which is the one to replace.
 */
function writeEntry(database: DatabaseSync, entry: NewEntry): Entry {
  const replaces = entry.kind === 'progress' ? null : (entry.replaces ?? null)
  try {
    const { id } = database
      .prepare(
        `INSERT INTO entries (kind, body, decided_by, source, written_by, replaces)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        entry.kind,
        entry.body,
        entry.kind === 'decision' ? entry.decidedBy : null,
        entry.kind === 'finding' ? entry.source : null,
        entry.writtenBy,
        replaces,
      ) as { id: number }
    return entryById(database, id) as Entry
  } catch (error) {
    if (replaces === null || (error as Error).message !== ALREADY_REPLACED) throw error
    const inForce = replacementLine(database, replaces).at(-1)
    throw new Error(
      `#${replaces} was already replaced: replace #${inForce}, which is in force in its place.`,
    )
  }
}

function entryById(database: DatabaseSync, id: number): Entry | undefined {
  const row = database
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`)
    .get(id)
  return row === undefined ? undefined : entryOf(row as unknown as EntryRow)
}

/** Every decision no later entry replaces, newest first. */
function decisionsInForce(database: DatabaseSync): Entry[] {
  return entriesOf(
    database
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM entries
         WHERE entries.id IN (SELECT id FROM entries_in_force WHERE kind = 'decision')
         ORDER BY entries.id DESC`,
      )
      .all(),
  )
}

/** The newest progress entries, newest first, and how many there are in all. */
function latestProgress(database: DatabaseSync, count: number) {
  const entries = entriesOf(
    database
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM entries
         WHERE kind = 'progress'
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(count),
  )
  const { total } = database
    .prepare(`SELECT count(*) AS total FROM entries WHERE kind = 'progress'`)
    .get() as { total: number }
  return { entries, total }
}

function findingCounts(database: DatabaseSync) {
  return database
    .prepare(
      `SELECT
         (SELECT count(*) FROM entries_in_force WHERE kind = 'finding') AS inForce,
         (SELECT count(*) FROM entries WHERE kind = 'finding') AS total`,
    )
    .get() as { inForce: number; total: number }
}

/** Every entry, oldest first. */
function allEntries(database: DatabaseSync): Entry[] {
  return entriesOf(
    database.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries ORDER BY id`).all(),
  )
}

/**
 * The numbers of every entry on this entry's line of replacements, oldest
 * first: what it replaced, back to the first, and what replaced it, up to
 * the one in force.
 */
function replacementLine(database: DatabaseSync, id: number): number[] {
  const rows = database
    .prepare(
      `WITH RECURSIVE
         earlier (id, replaces) AS (
           SELECT id, replaces FROM entries WHERE id = :id
           UNION ALL
           SELECT entries.id, entries.replaces FROM entries
           JOIN earlier ON entries.id = earlier.replaces
         ),
         later (id) AS (
           SELECT id FROM entries WHERE id = :id
           UNION ALL
           SELECT entries.id FROM entries JOIN later ON entries.replaces = later.id
         )
       SELECT id FROM earlier
       UNION
       SELECT id FROM later
       ORDER BY id`,
    )
    .all({ id }) as { id: number }[]
  return rows.map((row) => row.id)
}

/**
 * Plain words, never search syntax: every argument split on whitespace, each
 * word quoted as a term of its own.
 */
function searchTerms(words: string[]) {
  const unique = new Set(words.flatMap((word) => word.split(/\s+/)))
  unique.delete('')
  return [...unique].map((word) => `"${word.replaceAll('"', '""')}"`)
}

/**
 * Rebuild the search index when FTS5's own check finds it out of step with
 * the entries. Only the check with a rank of 1 compares the index against the
 * entries, so only it notices an index a stray command emptied. The check is
 * a write, so it runs only when the write lock is free at once: while another
 * connection holds a write open, the search reads the index as it is rather
 * than wait for it.
 */
function repairSearchIndex(database: DatabaseSync) {
  database.exec('PRAGMA busy_timeout = 0')
  try {
    inTransaction(database, () => {
      try {
        database.exec(
          `INSERT INTO entries_search (entries_search, rank) VALUES ('integrity-check', 1)`,
        )
      } catch (error) {
        if ((error as { errcode?: number }).errcode !== SQLITE_CORRUPT_VTAB) throw error
        database.exec(`INSERT INTO entries_search (entries_search) VALUES ('rebuild')`)
      }
    })
  } catch (error) {
    if ((error as { errcode?: number }).errcode !== SQLITE_BUSY) throw error
  } finally {
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT}`)
  }
}

/**
 * Every entry matching any of the words, in force or not, ordered by how many
 * of the words it matches, then newest first: the best matches, each with an
 * excerpt of its text, and how many matched in all.
 */
function searchEntries(database: DatabaseSync, words: string[]): SearchResults {
  const terms = searchTerms(words)
  if (terms.length === 0) return { matches: [], total: 0 }
  repairSearchIndex(database)
  const anyTerm = terms.join(' OR ')
  const matchedTerms = terms
    .map(
      () =>
        '(entries_search.rowid IN (SELECT rowid FROM entries_search WHERE entries_search MATCH ?))',
    )
    .join(' + ')
  const rows = database
    .prepare(
      `SELECT ${ENTRY_COLUMNS},
         snippet(entries_search, 0, '', '', '…', 32) AS excerpt,
         ${matchedTerms} AS matched_terms
       FROM entries_search
       JOIN entries ON entries.id = entries_search.rowid
       WHERE entries_search MATCH ?
       ORDER BY matched_terms DESC, entries.id DESC
       LIMIT ?`,
    )
    .all(...terms, anyTerm, SEARCH_LIMIT) as unknown as (EntryRow & { excerpt: string })[]
  const { total } = database
    .prepare('SELECT count(*) AS total FROM entries_search WHERE entries_search MATCH ?')
    .get(anyTerm) as { total: number }
  return {
    matches: rows.map((row) => ({ ...entryOf(row), excerpt: row.excerpt })),
    total,
  }
}

export type { DecidedBy, Entry, EntryKind, NewEntry, SearchResults }
export {
  allEntries,
  decisionsInForce,
  entryById,
  findingCounts,
  latestProgress,
  loadSqlite,
  openExistingRecord,
  openRecord,
  replacementLine,
  searchEntries,
  writeEntry,
}
