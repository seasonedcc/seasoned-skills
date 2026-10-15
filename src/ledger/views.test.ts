import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from './record.js'
import {
  entryReport,
  fittedInForceView,
  HOOK_BUDGET,
  inForceView,
  recordText,
  searchReport,
  writeAnswer,
} from './views.js'

const NOW = new Date('2026-10-14T18:30:00Z')

const TODAY = new Date('2026-10-14T18:12:40Z')

const FIVE_DAYS_AGO = new Date('2026-10-09T17:31:05Z')

function entry(fields: Partial<Entry> & Pick<Entry, 'id' | 'kind'>): Entry {
  return {
    body: 'text',
    decidedBy: fields.kind === 'decision' ? 'person' : null,
    source: fields.kind === 'finding' ? 'src/thing.ts:12' : null,
    writtenBy: 'orchestrator',
    replaces: null,
    replacedBy: null,
    writtenAt: TODAY,
    ...fields,
  }
}

function decisions(count: number, body: (index: number) => string) {
  return Array.from({ length: count }, (_, index) =>
    entry({ id: count - index, kind: 'decision', body: body(count - index) }),
  )
}

function view(
  decisionEntries: Entry[],
  progressEntries: Entry[] = [],
  findings = { inForce: 41, total: 44 },
) {
  return {
    decisions: decisionEntries,
    progress: { entries: progressEntries, total: progressEntries.length },
    findings,
    now: NOW,
  }
}

/** What the hook prints, newline included. */
function printedLength(text: string) {
  return text.length + 1
}

describe('the ledger views', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/Sao_Paulo')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("answers a write with the entry's number, kind, and local time with its offset", () => {
    expect(writeAnswer(entry({ id: 61, kind: 'finding' }))).toBe(
      '#61 finding, 2026-10-14 15:12:40 -03:00',
    )
  })

  it("shows today's entries by time of day and older ones by date and time", () => {
    const text = inForceView(
      view(
        [
          entry({ id: 52, kind: 'decision', body: 'No jobs, tasks, or statuses.' }),
          entry({
            id: 47,
            kind: 'decision',
            decidedBy: 'agent',
            writtenAt: FIVE_DAYS_AGO,
            body: 'Every agent writes.\nIn the same record.',
          }),
        ],
        [entry({ id: 58, kind: 'progress', body: 'Pushed 4e1a2c0.\nCI is green.' })],
      ),
    )
    expect(text).toBe(
      [
        'In force: 2 decisions, newest first',
        '  #52  person  orchestrator  15:12  No jobs, tasks, or statuses.',
        '  #47  agent  orchestrator  2026-10-09 14:31  Every agent writes.',
        '    In the same record.',
        'Latest progress: 1 of 1, newest first',
        '  #58  orchestrator  15:12  Pushed 4e1a2c0.',
        '    CI is green.',
        'Findings: 41 in force, 3 replaced. Search them with: pnpm exec seasoned-skills ledger search <words>',
      ].join('\n'),
    )
  })

  it('says so when nothing is in force yet', () => {
    expect(inForceView(view([], [], { inForce: 0, total: 0 }))).toBe(
      [
        'In force: no decisions',
        'Latest progress: none yet',
        'Findings: 0 in force, 0 replaced. Search them with: pnpm exec seasoned-skills ledger search <words>',
      ].join('\n'),
    )
  })

  it('prints one entry whole, with its line of replacements both ways', () => {
    const shown = entry({
      id: 58,
      kind: 'finding',
      writtenBy: 'sqlite-research',
      source: 'node -e on Node 22.22',
      body: 'First line.\nSecond line.',
    })
    expect(entryReport(shown, [40, 58, 64])).toBe(
      [
        '#58 finding, 2026-10-14 15:12:40 -03:00',
        'Written by sqlite-research',
        'Source: node -e on Node 22.22',
        'Replacement line, oldest first: #40 → #58 (this entry) → #64',
        '',
        'First line.\nSecond line.',
      ].join('\n'),
    )
    expect(entryReport(entry({ id: 3, kind: 'decision', body: 'A rule.' }), [3])).toBe(
      [
        '#3 decision, 2026-10-14 15:12:40 -03:00',
        'Decided by the person',
        'Written by orchestrator',
        '',
        'A rule.',
      ].join('\n'),
    )
  })

  it('prints the whole record in order, each replacement linked both ways', () => {
    expect(
      recordText('11111111-1111-4111-8111-111111111111', [
        entry({ id: 1, kind: 'decision', body: 'Use a file.', replacedBy: 2 }),
        entry({ id: 2, kind: 'decision', body: 'Use a database.', replaces: 1 }),
      ]),
    ).toBe(
      [
        'Ledger of session 11111111-1111-4111-8111-111111111111: 2 entries, oldest first',
        '',
        '#1 decision, 2026-10-14 15:12:40 -03:00',
        'Decided by the person',
        'Written by orchestrator',
        'Replaced by #2',
        '',
        'Use a file.',
        '',
        '#2 decision, 2026-10-14 15:12:40 -03:00',
        'Decided by the person',
        'Written by orchestrator',
        'Replaces #1',
        '',
        'Use a database.',
      ].join('\n'),
    )
  })

  it('lists search results with where each came from, and how many more there are', () => {
    const report = searchReport(
      {
        matches: [
          {
            ...entry({
              id: 61,
              kind: 'finding',
              writtenBy: 'sqlite-research',
              source: 'node -e',
              replacedBy: 64,
              writtenAt: FIVE_DAYS_AGO,
            }),
            excerpt: '…prints a warning\non Node 22…',
          },
          { ...entry({ id: 52, kind: 'decision' }), excerpt: 'No jobs.' },
        ],
        total: 25,
      },
      NOW,
    )
    expect(report).toBe(
      [
        '#61 finding, written by sqlite-research, 2026-10-09 14:31, replaced by #64',
        '  Source: node -e',
        '  …prints a warning',
        '  on Node 22…',
        '',
        '#52 decision, decided by the person, written by orchestrator, 15:12',
        '  No jobs.',
        '',
        '23 more not shown',
      ].join('\n'),
    )
    expect(searchReport({ matches: [], total: 0 }, NOW)).toBe(
      "Nothing in this session's ledger matches those words.",
    )
  })

  describe('fitted for the compaction hook', () => {
    it('prints the same view as ledger when everything fits', () => {
      const small = view(
        decisions(3, (id) => `Rule ${id}.`),
        [entry({ id: 9, kind: 'progress', body: 'Launched.' })],
      )
      expect(fittedInForceView(small)).toBe(inForceView(small))
    })

    it('cuts each progress entry to its first line and 200 characters', () => {
      const text = fittedInForceView(
        view(
          [],
          [
            entry({ id: 2, kind: 'progress', body: `${'x'.repeat(300)}` }),
            entry({ id: 1, kind: 'progress', body: 'Launched.\nMore detail.' }),
          ],
        ),
      )
      expect(text).toContain(`  #2  orchestrator  15:12  ${'x'.repeat(200)}…\n`)
      expect(text).toContain('  #1  orchestrator  15:12  Launched.…\n')
      expect(text).not.toContain('More detail.')
    })

    it('fills the budget with whole decisions, newest first, then counts the older ones', () => {
      const many = view(
        decisions(400, (id) => `Decision ${id}: ${'w'.repeat(60)}`),
        Array.from({ length: 10 }, (_, index) =>
          entry({ id: 1000 + index, kind: 'progress', body: 'p'.repeat(300) }),
        ),
      )
      const text = fittedInForceView(many)
      expect(printedLength(text)).toBeLessThanOrEqual(HOOK_BUDGET)
      const shown = [...text.matchAll(/ {2}#(\d+) {2}person/g)].map((match) =>
        Number(match[1]),
      )
      expect(shown[0]).toBe(400)
      expect(shown).toEqual(shown.map((_, index) => 400 - index))
      for (const id of shown) {
        expect(text).toContain(`Decision ${id}: ${'w'.repeat(60)}\n`)
      }
      expect(text).toContain(
        `${400 - shown.length} older decisions in force: run \`pnpm exec seasoned-skills ledger\``,
      )
      const nextLine = `  #${400 - shown.length}  person  orchestrator  15:12  Decision ${400 - shown.length}: ${'w'.repeat(60)}`
      expect(printedLength(text) + nextLine.length + 1).toBeGreaterThan(HOOK_BUDGET - 100)
    })

    it('stops at the first decision that does not fit, never skipping it for an older one', () => {
      const text = fittedInForceView(
        view([
          entry({ id: 3, kind: 'decision', body: 'a'.repeat(5000) }),
          entry({ id: 2, kind: 'decision', body: 'b'.repeat(5000) }),
          entry({ id: 1, kind: 'decision', body: 'Short.' }),
        ]),
      )
      expect(text).toContain('a'.repeat(5000))
      expect(text).not.toContain('b'.repeat(10))
      expect(text).not.toContain('Short.')
      expect(text).toContain(
        '2 older decisions in force: run `pnpm exec seasoned-skills ledger`',
      )
    })

    it('fits a decision exactly as long as the room, and points at one a character longer', () => {
      const withBody = (length: number) =>
        fittedInForceView(
          view([
            entry({ id: 2, kind: 'decision', body: 'z'.repeat(length) }),
            entry({ id: 1, kind: 'decision', body: 'Older.' }),
          ]),
        )
      let longest = HOOK_BUDGET
      while (!withBody(longest).includes('z'.repeat(longest))) longest -= 1

      const fitted = withBody(longest)
      expect(printedLength(fitted)).toBeLessThanOrEqual(HOOK_BUDGET)
      expect(printedLength(fitted)).toBeGreaterThan(HOOK_BUDGET - 10)
      expect(fitted).toContain('1 older decision in force')

      const tooLong = withBody(longest + 1)
      expect(tooLong).not.toContain('zzz')
      expect(tooLong).toContain(
        '  #2 is too long for this view: run `pnpm exec seasoned-skills ledger show 2`\n',
      )
      expect(tooLong).toContain('  #1  person  orchestrator  15:12  Older.\n')
      expect(tooLong).not.toContain('older decision')
    })
  })
})
