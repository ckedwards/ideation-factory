// The schemas whose migrations are tested and frozen: each actor type's
// database, how to migrate it, and how to dump and load it.
import { Database } from 'bun:sqlite'
import { DIRECTORY_SCHEMA_VERSION, migrateDirectory } from '../directory/schema.ts'
import { fts5Search } from '../directory/search.ts'
import { IDEA_SCHEMA_VERSION, migrate } from '../idea/schema.ts'
import type { Sql } from '../idea/sql.ts'
import { bunSql } from '../idea/sql-bun.ts'

export interface MigratedSchema {
  name: 'idea' | 'directory'
  version: number
  migrate(sql: Sql, to?: number): Promise<void>
}

export const SCHEMAS: MigratedSchema[] = [
  { name: 'idea', version: IDEA_SCHEMA_VERSION, migrate: (sql, to) => migrate(sql, to) },
  {
    name: 'directory',
    version: DIRECTORY_SCHEMA_VERSION,
    migrate: (sql, to) => migrateDirectory(sql, [fts5Search().migrate], to),
  },
]

export const frozenPath = (schema: string, version: number) =>
  new URL(`./frozen/${schema}-v${version}.sql`, import.meta.url).pathname

export function emptyDatabase(): { db: Database; sql: Sql } {
  const db = new Database(':memory:')
  return { db, sql: bunSql(db) }
}

type MasterRow = { type: string; name: string; tbl_name: string; sql: string | null }

/**
 * A database's schema as the statements that create it, in creation order.
 * Leaves out what SQLite makes by itself: automatic indexes, and the shadow
 * tables behind a full-text index (CREATE VIRTUAL TABLE makes those again).
 */
export function schemaStatements(db: Database): string[] {
  const rows = db.query('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid').all() as MasterRow[]
  const virtual = rows.filter((r) => r.sql?.startsWith('CREATE VIRTUAL TABLE')).map((r) => r.name)
  return rows
    .filter((r) => r.sql !== null && !r.name.startsWith('sqlite_'))
    .filter((r) => !virtual.some((v) => r.name !== v && r.name.startsWith(`${v}_`)))
    .map((r) => `${r.sql!.replace(/\s+/g, ' ').trim()};`)
}

/** The frozen form of a schema version: its statements, then its schema_version row. */
export function dump(db: Database, version: number): string {
  return `${[...schemaStatements(db), `INSERT INTO schema_version (version) VALUES (${version});`].join('\n')}\n`
}

/** A database as it was at a frozen version (as a real actor's would be), ready to migrate. */
export function loadFrozen(text: string): { db: Database; sql: Sql } {
  const database = emptyDatabase()
  for (const statement of text.split('\n').filter(Boolean)) {
    database.db.run(statement)
  }
  return database
}
