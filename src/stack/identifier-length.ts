/**
 * The stack layer's deterministic identifier-length check. Postgres silently
 * truncates identifiers past 63 bytes, and the stack's camel-case plugin
 * expands compiled index and constraint names — so a declared name can land
 * in the database truncated, diverging source from schema until the first
 * by-name reference trips over it. A project's suite runs the audit query
 * against a migrated database and fails on any identifier at the engine's
 * limit: a truncated name always measures exactly 63 bytes, and a deliberate
 * 63-byte name is a rename away from unambiguous.
 */

export const IDENTIFIER_BYTE_LIMIT = 63

/**
 * Returns every user-schema identifier (relations, constraints, attributes,
 * enum types) whose name is at the truncation limit, as rows of
 * `{ kind, name }`. Run it with any query runner against the migrated
 * database.
 */
export const IDENTIFIER_LENGTH_AUDIT_SQL = `
  select kind, name from (
    select 'relation' as kind, relname as name
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
     where nspname !~ '^pg_' and nspname <> 'information_schema'
    union all
    select 'constraint' as kind, conname as name
      from pg_constraint
      join pg_namespace on pg_namespace.oid = pg_constraint.connamespace
     where nspname !~ '^pg_' and nspname <> 'information_schema'
    union all
    select 'column' as kind, attname as name
      from pg_attribute
      join pg_class on pg_class.oid = pg_attribute.attrelid
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
     where nspname !~ '^pg_' and nspname <> 'information_schema'
       and attnum > 0 and not attisdropped
    union all
    select 'type' as kind, typname as name
      from pg_type
      join pg_namespace on pg_namespace.oid = pg_type.typnamespace
     where nspname !~ '^pg_' and nspname <> 'information_schema'
       and typtype = 'e'
  ) identifiers
  where octet_length(name) >= ${IDENTIFIER_BYTE_LIMIT}
  order by kind, name
`

export interface IdentifierRow {
  kind: string
  name: string
}

/** The assertion a suite makes: an empty list, or a message per offender. */
export function identifierLengthFailures(rows: IdentifierRow[]): string[] {
  return rows.map(
    (row) =>
      `${row.kind} "${row.name}" is at Postgres's ${IDENTIFIER_BYTE_LIMIT}-byte identifier limit — it is truncated (or indistinguishable from truncated); choose a shorter declared name`,
  )
}
