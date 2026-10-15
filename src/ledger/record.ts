import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

/**
 * The ledger's record: one SQLite database per session, which accepts new
 * entries and refuses every edit and every delete on its own, whoever asks.
 * A decision or a finding is in force until a later entry of its own kind
 * replaces it; progress is never replaced. The search index is derived from
 * the entries and is the one part a stray command can empty, so every search
 * checks it first and rebuilds it when it fails.
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

const SQLITE_CORRUPT_VTAB = 267

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
    SELECT RAISE(ABORT, 'Ledger entries are never edited: #' || OLD.id || ' stays exactly as it was written. Record a new entry instead.');
  END;

  CREATE TRIGGER IF NOT EXISTS entries_are_never_deleted
  BEFORE DELETE ON entries
  BEGIN
    SELECT RAISE(ABORT, 'Ledger entries are never deleted: #' || OLD.id || ' stays exactly as it was written.');
  END;

  CREATE TRIGGER IF NOT EXISTS entries_are_never_overwritten
  BEFORE INSERT ON entries
  WHEN EXISTS (SELECT 1 FROM entries WHERE id = NEW.id)
  BEGIN
    SELECT RAISE(ABORT, 'Ledger entries are never overwritten: #' || NEW.id || ' stays exactly as it was written.');
  END;

  CREATE TRIGGER IF NOT EXISTS replacements_replace_what_is_in_force
  BEFORE INSERT ON entries
  WHEN NEW.replaces IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'Progress is never replaced and never replaces anything.')
    WHERE NEW.kind = 'progress';
    SELECT RAISE(ABORT, 'There is no entry #' || NEW.replaces || ' to replace.')
    WHERE NOT EXISTS (SELECT 1 FROM entries WHERE id = NEW.replaces);
    SELECT RAISE(ABORT, '#' || NEW.replaces || ' is progress, and progress is never replaced.')
    WHERE (SELECT kind FROM entries WHERE id = NEW.replaces) = 'progress';
    SELECT RAISE(ABORT, '#' || NEW.replaces || ' is a ' || replaced.kind || ', and a ' || NEW.kind || ' replaces only a ' || NEW.kind || '.')
    FROM entries AS replaced
    WHERE replaced.id = NEW.replaces AND replaced.kind <> NEW.kind;
    SELECT RAISE(ABORT, '#' || NEW.replaces || ' was already replaced by #' || later.id || ': replace #' || later.id || ' instead.')
    FROM entries AS later
    WHERE later.replaces = NEW.replaces;
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

async function loadSqlite() {
  try {
    return await import('node:sqlite')
  } catch {
    throw new Error('The ledger needs Node 22.13 or later.')
  }
}

async function connect(path: string) {
  const { DatabaseSync } = await loadSqlite()
  const database = new DatabaseSync(path)
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec('PRAGMA journal_mode = WAL')
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

/** Record a new entry, stamped by the database's own clock. */
function writeEntry(database: DatabaseSync, entry: NewEntry): Entry {
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
      entry.kind === 'progress' ? null : (entry.replaces ?? null),
    ) as { id: number }
  return entryById(database, id) as Entry
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
 * entries, so only it notices an index a stray command emptied.
 */
function repairSearchIndex(database: DatabaseSync) {
  try {
    database.exec(
      `INSERT INTO entries_search (entries_search, rank) VALUES ('integrity-check', 1)`,
    )
  } catch (error) {
    if ((error as { errcode?: number }).errcode !== SQLITE_CORRUPT_VTAB) throw error
    database.exec(`INSERT INTO entries_search (entries_search) VALUES ('rebuild')`)
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
  openExistingRecord,
  openRecord,
  replacementLine,
  SEARCH_LIMIT,
  searchEntries,
  writeEntry,
}
