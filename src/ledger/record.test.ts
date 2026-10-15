import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allEntries,
  decisionsInForce,
  entryById,
  findingCounts,
  latestProgress,
  openExistingRecord,
  openRecord,
  replacementLine,
  searchEntries,
  writeEntry,
} from './record.js'

describe('the ledger record', () => {
  let directory: string
  let path: string
  let database: DatabaseSync

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'seasoned-skills-ledger-'))
    path = join(directory, 'ledger.db')
    database = await openRecord(path)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function decision(body: string, replaces?: number) {
    return writeEntry(database, {
      kind: 'decision',
      body,
      writtenBy: 'orchestrator',
      decidedBy: 'person',
      ...(replaces === undefined ? {} : { replaces }),
    })
  }

  function finding(body: string, options: { replaces?: number; source?: string } = {}) {
    return writeEntry(database, {
      kind: 'finding',
      body,
      writtenBy: 'researcher',
      source: options.source ?? 'src/thing.ts:12',
      ...(options.replaces === undefined ? {} : { replaces: options.replaces }),
    })
  }

  function progress(body: string) {
    return writeEntry(database, { kind: 'progress', body, writtenBy: 'orchestrator' })
  }

  function inTransaction(work: () => void) {
    database.exec('BEGIN')
    work()
    database.exec('COMMIT')
  }

  it('creates its file and schema on the first open, and reads never create one', async () => {
    const elsewhere = join(directory, 'missing.db')
    expect(await openExistingRecord(elsewhere)).toBeUndefined()
    expect(allEntries(database)).toEqual([])
    const reopened = await openExistingRecord(path)
    expect(reopened).toBeDefined()
    reopened?.close()
  })

  it('sets a busy timeout and WAL mode on every connection', async () => {
    const reader = await openExistingRecord(path)
    for (const connection of [database, reader as DatabaseSync]) {
      expect(connection.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
      expect(connection.prepare('PRAGMA journal_mode').get()).toEqual({
        journal_mode: 'wal',
      })
    }
    reader?.close()
  })

  it("stamps each entry with the database's own clock, in UTC", () => {
    const before = Math.floor(Date.now() / 1000) * 1000
    const entry = progress('Launched the build.')
    const after = Date.now()
    expect(entry.writtenAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(entry.writtenAt.getTime()).toBeLessThanOrEqual(after)
    const { written_at } = database
      .prepare('SELECT written_at FROM entries WHERE id = ?')
      .get(entry.id) as { written_at: string }
    expect(written_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  })

  it('keeps the text exactly as it was written', () => {
    const body = '  leading spaces\n$(echo never) `nor this`\n\ttab and trailing  \n'
    expect(entryById(database, decision(body).id)?.body).toBe(body)
  })

  describe('the guards', () => {
    beforeEach(() => {
      decision('Every agent writes to the same record.')
      finding('The sweep removes whole folders.')
    })

    function refusedWithoutChange(statement: string, message: RegExp) {
      const before = allEntries(database)
      expect(() => database.exec(statement)).toThrow(message)
      expect(allEntries(database)).toEqual(before)
    }

    it('refuses an edit', () => {
      refusedWithoutChange(
        `UPDATE entries SET body = 'rewritten' WHERE id = 1`,
        /Ledger entries are never edited: #1 stays exactly as it was written/,
      )
    })

    it('refuses an upsert', () => {
      refusedWithoutChange(
        `INSERT INTO entries (id, kind, body, decided_by, written_by)
         VALUES (1, 'decision', 'rewritten', 'agent', 'orchestrator')
         ON CONFLICT (id) DO UPDATE SET body = excluded.body`,
        /Ledger entries are never overwritten: #1/,
      )
    })

    it('refuses a delete', () => {
      refusedWithoutChange(
        'DELETE FROM entries WHERE id = 2',
        /Ledger entries are never deleted: #2 stays exactly as it was written/,
      )
    })

    it('refuses a whole-table delete', () => {
      refusedWithoutChange('DELETE FROM entries', /Ledger entries are never deleted/)
    })

    it('refuses INSERT OR REPLACE and REPLACE INTO', () => {
      for (const verb of ['INSERT OR REPLACE', 'REPLACE']) {
        refusedWithoutChange(
          `${verb} INTO entries (id, kind, body, decided_by, written_by)
           VALUES (1, 'decision', 'swapped', 'agent', 'orchestrator')`,
          /Ledger entries are never overwritten: #1/,
        )
      }
    })
  })

  describe('replacements', () => {
    it('refuses to replace progress', () => {
      const launched = progress('Launched the build.')
      expect(() => finding('Wrong.', { replaces: launched.id })).toThrow(
        `#${launched.id} is progress, and progress is never replaced.`,
      )
    })

    it('refuses progress that replaces anything', () => {
      decision('A rule.')
      expect(() =>
        database.exec(
          `INSERT INTO entries (kind, body, written_by, replaces)
           VALUES ('progress', 'Superseding.', 'orchestrator', 1)`,
        ),
      ).toThrow('Progress is never replaced and never replaces anything.')
    })

    it('refuses to replace an entry of another kind', () => {
      const learned = finding('A fact.')
      expect(() => decision('A rule.', learned.id)).toThrow(
        `#${learned.id} is a finding, and a decision replaces only a decision.`,
      )
    })

    it('refuses to replace an entry that does not exist yet', () => {
      decision('A rule.')
      expect(() => decision('Another rule.', 2)).toThrow(
        'There is no entry #2 to replace.',
      )
    })

    it('refuses to replace an entry something already replaced', () => {
      const first = decision('Use a file.')
      const second = decision('Use a database.', first.id)
      expect(() => decision('Use both.', first.id)).toThrow(
        `#${first.id} was already replaced by #${second.id}: replace #${second.id} instead.`,
      )
    })

    it('keeps replaced entries out of what is in force, and every link of the line readable', () => {
      const first = decision('Use a file.')
      const kept = decision('Every agent writes.')
      const second = decision('Use a database.', first.id)
      const third = decision('Use SQLite.', second.id)

      expect(decisionsInForce(database).map((entry) => entry.id)).toEqual([
        third.id,
        kept.id,
      ])
      expect(entryById(database, first.id)).toMatchObject({
        body: 'Use a file.',
        replacedBy: second.id,
      })
      expect(entryById(database, second.id)).toMatchObject({
        replaces: first.id,
        replacedBy: third.id,
      })
      const line = [first.id, second.id, third.id]
      for (const id of line) expect(replacementLine(database, id)).toEqual(line)
      expect(replacementLine(database, kept.id)).toEqual([kept.id])
    })

    it('counts the findings in force and in all', () => {
      const wrong = finding('The hook fires for subagents.')
      finding('The hook fires only for the orchestrator.', { replaces: wrong.id })
      finding('Search uses FTS5.')
      expect(findingCounts(database)).toEqual({ inForce: 2, total: 3 })
    })
  })

  describe('the kinds', () => {
    function insert(columns: string, values: string) {
      return () =>
        database.exec(`INSERT INTO entries (kind, body, written_by, ${columns})
                       VALUES (${values})`)
    }

    it('requires who decided on a decision, and nowhere else', () => {
      expect(insert('source', `'decision', 'x', 'orchestrator', 'a source'`)).toThrow(
        /CHECK constraint failed/,
      )
      expect(
        insert('decided_by, source', `'finding', 'x', 'researcher', 'person', 'here'`),
      ).toThrow(/CHECK constraint failed/)
    })

    it('requires a source on a finding, and nowhere else', () => {
      expect(insert('decided_by', `'finding', 'x', 'researcher', NULL`)).toThrow(
        /CHECK constraint failed/,
      )
      expect(insert('source', `'progress', 'x', 'orchestrator', 'here'`)).toThrow(
        /CHECK constraint failed/,
      )
    })

    it('lists the latest progress newest first, with the total', () => {
      for (const step of ['one', 'two', 'three']) progress(step)
      const latest = latestProgress(database, 2)
      expect(latest.entries.map((entry) => entry.body)).toEqual(['three', 'two'])
      expect(latest.total).toBe(3)
    })
  })

  describe('search', () => {
    function searched(...words: string[]) {
      return searchEntries(database, words).matches.map((match) => match.body)
    }

    it('orders by how many of the words match, then newest first', () => {
      finding('busy timeout set on the connection')
      finding('busy writers wait')
      finding('timeout of ten seconds')
      expect(searched('busy', 'timeout')).toEqual([
        'busy timeout set on the connection',
        'timeout of ten seconds',
        'busy writers wait',
      ])
    })

    it('splits every argument on whitespace, so quoted words are never a phrase', () => {
      finding('a busy writer')
      finding('a timeout')
      expect(searched('busy timeout')).toEqual(['a timeout', 'a busy writer'])
    })

    it('reads every word as plain text, never as search syntax', () => {
      finding('node:sqlite needs Node 22.13')
      finding('issue #418 ran four commands')
      finding('a busy-timeout pragma')
      finding('this or that')
      finding('nothing else here')
      finding('a "quoted" word')
      expect(searched('node:sqlite')).toEqual(['node:sqlite needs Node 22.13'])
      expect(searched('#418')).toEqual(['issue #418 ran four commands'])
      expect(searched('busy-timeout')).toEqual(['a busy-timeout pragma'])
      expect(searched('OR')).toEqual(['this or that'])
      expect(searched('"quoted"')).toEqual(['a "quoted" word'])
      expect(searched('-', '#', 'AND', 'NOT', '*')).toEqual([])
    })

    it('covers the source and the replaced entries, matching a word by its stem', () => {
      const wrong = finding('Every lane provisions a database.', { source: 'probe' })
      finding('Only declared lanes get one.', {
        replaces: wrong.id,
        source: 'src/registry/index.ts:40',
      })
      const { matches } = searchEntries(database, ['lane'])
      expect(matches.map((match) => [match.id, match.replacedBy])).toEqual([
        [2, null],
        [1, 2],
      ])
      expect(searched('registry')).toEqual(['Only declared lanes get one.'])
    })

    it('excerpts the text without rewording it, ending in an ellipsis when shortened', () => {
      const words = Array.from({ length: 80 }, (_, index) => `word${index}`)
      finding(`${words.join(' ')} needle`)
      finding('short needle')
      const { matches } = searchEntries(database, ['needle'])
      expect(matches[0]?.excerpt).toBe('short needle')
      const long = matches[1]?.excerpt ?? ''
      expect(long.startsWith('…')).toBe(true)
      expect(long.endsWith('needle')).toBe(true)
      expect(`${words.join(' ')} needle`).toContain(long.slice(1))
      expect(searchEntries(database, ['word0']).matches[0]?.excerpt).toMatch(
        /^word0 .*…$/,
      )
    })

    it('prints the 20 best and counts the rest', () => {
      for (let index = 0; index < 25; index += 1) finding(`match number ${index}`)
      const { matches, total } = searchEntries(database, ['match'])
      expect(matches).toHaveLength(20)
      expect(total).toBe(25)
      expect(matches[0]?.body).toBe('match number 24')
    })

    it('rebuilds an index a stray command emptied before it searches', () => {
      finding('the record survives')
      database.exec(`INSERT INTO entries_search (entries_search) VALUES ('delete-all')`)
      expect(
        database
          .prepare(`SELECT rowid FROM entries_search WHERE entries_search MATCH 'record'`)
          .all(),
      ).toEqual([])
      expect(searched('record')).toEqual(['the record survives'])
    })
  })

  it('holds thousands of entries while the in-force reads stay small', () => {
    inTransaction(() => {
      for (let index = 0; index < 1000; index += 1) {
        const replacedDecision = decision(`rule ${index}`)
        if (index % 10 !== 0) decision(`rule ${index} revised`, replacedDecision.id)
        const replacedFinding = finding(`fact ${index}`)
        if (index % 2 === 0)
          finding(`fact ${index} corrected`, { replaces: replacedFinding.id })
        progress(`step ${index}`)
      }
    })
    expect(allEntries(database).length).toBeGreaterThan(4000)
    expect(decisionsInForce(database)).toHaveLength(1000)
    expect(decisionsInForce(database).every((entry) => entry.replacedBy === null)).toBe(
      true,
    )
    expect(findingCounts(database)).toEqual({ inForce: 1000, total: 1500 })
    expect(latestProgress(database, 10).entries).toHaveLength(10)
    const { matches, total } = searchEntries(database, ['fact'])
    expect(matches).toHaveLength(20)
    expect(total).toBe(1500)
  })
})
