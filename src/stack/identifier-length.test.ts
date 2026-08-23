import { describe, expect, it } from 'vitest'
import {
  IDENTIFIER_BYTE_LIMIT,
  IDENTIFIER_LENGTH_AUDIT_SQL,
  identifierLengthFailures,
} from './identifier-length.js'

describe('identifier length audit', () => {
  it('audits every user-schema identifier class at the engine limit', () => {
    for (const clause of ['pg_class', 'pg_constraint', 'pg_attribute', 'pg_type']) {
      expect(IDENTIFIER_LENGTH_AUDIT_SQL).toContain(clause)
    }
    expect(IDENTIFIER_LENGTH_AUDIT_SQL).toContain(
      `octet_length(name) >= ${IDENTIFIER_BYTE_LIMIT}`,
    )
  })

  it('reports nothing for a clean schema', () => {
    expect(identifierLengthFailures([])).toEqual([])
  })

  it('names each offender with its kind and the remedy', () => {
    const failures = identifierLengthFailures([
      { kind: 'relation', name: 'x'.repeat(63) },
      { kind: 'constraint', name: 'y'.repeat(63) },
    ])
    expect(failures).toHaveLength(2)
    expect(failures[0]).toContain('relation')
    expect(failures[0]).toContain('shorter declared name')
  })
})
