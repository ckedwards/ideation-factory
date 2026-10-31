// Searching ideas, behind its own interface because it's what differs most
// between databases: FTS5 with the trigram tokenizer here, pg_trgm for the
// Postgres escape hatch. The search gives a subquery of matching IDs, and the
// directory joins its access filter and its ranking onto it, so the limit
// applies to ideas you can see (never to all matches, which could hide yours)
// and ranking is the same everywhere.
import { type AliasedRawBuilder, type Kysely, sql as raw } from 'kysely'
import type { Sql } from '../idea/sql.ts'
import type { DB } from './schema.ts'

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
  migrate(sql: Sql): Promise<void>
  /** Keeps an idea's searchable text current; called in the same transaction as its index row. */
  index(db: Kysely<DB>, id: string, title: string): Promise<void>
  /** A subquery `m(id)` of the `cap` most recently updated ideas matching `terms`, or null if nothing can match. */
  matching(terms: string[], cap: number): AliasedRawBuilder<{ id: string }, 'm'> | null
  /** Whether more than `cap` ideas match (counting stops at cap + 1). */
  exceeds(db: Kysely<DB>, terms: string[], cap: number): Promise<boolean>
}

/** The query's terms that can be searched: whitespace-separated, at least MIN_SEARCH characters each. */
export function searchTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((t) => [...t].length >= MIN_SEARCH)
}

export function fts5Search(): IdeaSearch {
  return {
    async migrate(sql) {
      await sql.execute("CREATE VIRTUAL TABLE IF NOT EXISTS idea_search USING fts5(id UNINDEXED, title, tokenize = 'trigram')")
    },
    async index(db, id, title) {
      await raw`DELETE FROM idea_search WHERE id = ${id}`.execute(db)
      await raw`INSERT INTO idea_search (id, title) VALUES (${id}, ${title})`.execute(db)
    },
    matching(terms, cap) {
      if (terms.length === 0) return null
      // rows are re-inserted when a title changes, so the newest rowids are the most recently updated ideas,
      // and FTS5 reads them in that order without sorting
      return raw<{ id: string }>`(SELECT id FROM idea_search WHERE idea_search MATCH ${ftsMatch(terms)} ORDER BY rowid DESC LIMIT ${cap})`.as('m')
    },
    async exceeds(db, terms, cap) {
      if (terms.length === 0) return false
      const rows = await raw<{ n: number }>`SELECT count(*) AS n FROM (SELECT 1 FROM idea_search WHERE idea_search MATCH ${ftsMatch(terms)} LIMIT ${cap + 1})`.execute(db)
      return Number(rows.rows[0]?.n ?? 0) > cap
    },
  }
}

function ftsMatch(terms: string[]): string {
  return terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ')
}
