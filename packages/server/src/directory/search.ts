// Searching ideas' titles, behind its own interface and in its own database:
// the search actor's (actors/search.ts), so a search runs beside the
// directory instead of taking turns on its one connection. A full-text match
// of a common word costs about 25 ms at 100,000 ideas, and searches are about
// a tenth of page views: half the directory's time, when it was inside it
// (packages/load). FTS5 with the trigram tokenizer here, pg_trgm for the
// Postgres escape hatch. The search gives matching IDs; the directory applies
// access and ranking to them, so the limit applies to ideas you can see
// (never to all matches, which could hide yours) and ranking is the same
// everywhere.
import type { Sql } from '../sql/sql.ts'

/** Searches need at least this many characters: a trigram index can't match less, and there's no full scan. */
export const MIN_SEARCH = 3

/**
 * The most matches one search reads. Like Elasticsearch's terminate_after, it
 * caps the work rather than the time, so the same search always gives the same
 * answer: past it, the most recently updated matches are used and the result
 * says it's incomplete. The index stops reading at the cap, which a relevance
 * score can't (it has to score every match first).
 */
export const SEARCH_WORK_CAP = 20_000

export interface IdeaSearch {
  /** Keeps ideas' titles current, in order: each one becomes the most recently updated. */
  index(entries: Array<{ id: string; title: string }>): Promise<void>
  /** Up to `cap` ideas matching `terms`, the most recently updated first, and whether more matched. */
  matches(terms: string[], cap: number): Promise<{ ids: string[]; incomplete: boolean }>
}

/** The query's terms that can be searched: whitespace-separated, at least MIN_SEARCH characters each. */
export function searchTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((t) => [...t].length >= MIN_SEARCH)
}

const MIGRATIONS: Array<(sql: Sql) => Promise<void>> = [
  async (sql) => {
    // rows are re-inserted when an idea changes, so the newest rowids are the most recently updated ideas,
    // and FTS5 reads them in that order without sorting
    await sql.execute("CREATE VIRTUAL TABLE idea_search USING fts5(id UNINDEXED, title, tokenize = 'trigram')")
    // each idea's row in idea_search: FTS5 can't index its id column, so finding a row by id read every row
    // (6.6 ms a time at 100,000 ideas when packages/load measured it)
    await sql.execute('CREATE TABLE search_rows (idea TEXT PRIMARY KEY, row INTEGER NOT NULL)')
  },
]

/** The search schema's current version: the number of migrations. */
export const SEARCH_SCHEMA_VERSION = MIGRATIONS.length

/** Migrates a search database; `to` stops at an earlier version, for migration tests. */
export async function migrateSearch(sql: Sql, to = SEARCH_SCHEMA_VERSION): Promise<void> {
  await sql.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const rows = await sql.execute<{ version: number }>('SELECT version FROM schema_version')
  if (rows.length === 0) {
    await sql.execute('INSERT INTO schema_version (version) VALUES (0)')
  }
  for (let current = Number(rows[0]?.version ?? 0); current < to; current++) {
    await MIGRATIONS[current]!(sql)
    await sql.execute('UPDATE schema_version SET version = ?', current + 1)
  }
}

/** The search index in a SQLite database of its own (migrateSearch): the search actor's, or a test's. */
export function fts5Search(sql: Sql): IdeaSearch {
  return {
    async index(entries) {
      if (entries.length === 0) {
        return
      }
      await sql.transaction(async (tx) => {
        for (const { id, title } of entries) {
          const held = await tx.execute<{ row: number }>('SELECT row FROM search_rows WHERE idea = ?', id)
          if (held[0]) {
            await tx.execute('DELETE FROM idea_search WHERE rowid = ?', held[0].row)
          }
          await tx.execute('INSERT INTO idea_search (id, title) VALUES (?, ?)', id, title)
          await tx.execute(
            'INSERT INTO search_rows (idea, row) VALUES (?, last_insert_rowid()) ON CONFLICT (idea) DO UPDATE SET row = excluded.row',
            id,
          )
        }
      })
    },
    async matches(terms, cap) {
      if (terms.length === 0) {
        return { ids: [], incomplete: false }
      }
      // one past the cap says whether there were more, in the same read
      const rows = await sql.execute<{ id: string }>(
        'SELECT id FROM idea_search WHERE idea_search MATCH ? ORDER BY rowid DESC LIMIT ?',
        ftsMatch(terms),
        cap + 1,
      )
      return { ids: rows.slice(0, cap).map((r) => r.id), incomplete: rows.length > cap }
    },
  }
}

function ftsMatch(terms: string[]): string {
  return terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ')
}
