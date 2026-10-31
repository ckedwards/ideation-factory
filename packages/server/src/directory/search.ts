// Searching ideas, behind its own interface because it's what differs most
// between databases: FTS5 with the trigram tokenizer here, pg_trgm for the
// Postgres escape hatch. The search gives a subquery of matching IDs with a
// rank, and the directory joins its access filter onto it, so the limit applies
// to ideas you can see (not to all matches, which could hide yours). Ranking by
// closeness stays in our code, so it's the same everywhere.
import { type AliasedRawBuilder, type Kysely, sql as raw } from 'kysely'
import type { Sql } from '../idea/sql.ts'
import type { DB } from './schema.ts'

/** Searches need at least this many characters: a trigram index can't match less, and there's no full scan. */
export const MIN_SEARCH = 3

export interface IdeaSearch {
  migrate(sql: Sql): Promise<void>
  /** Keeps an idea's searchable text current; called in the same transaction as its index row. */
  index(db: Kysely<DB>, id: string, title: string): Promise<void>
  /** A subquery `m(id, rank)` of the ideas matching `terms` (lower rank is better), or null if nothing can match. */
  matching(terms: string[]): AliasedRawBuilder<{ id: string; rank: number }, 'm'> | null
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
    matching(terms) {
      if (terms.length === 0) return null
      const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ')
      return raw<{ id: string; rank: number }>`(SELECT id, bm25(idea_search) AS rank FROM idea_search WHERE idea_search MATCH ${match})`.as('m')
    },
  }
}

/** How closely a title matches: an exact match first, then from the start, then from a word's start, then anywhere. */
export function closeness(title: string, query: string): number {
  const t = title.toLowerCase()
  const q = query.trim().toLowerCase()
  if (t === q) return 0
  if (t.startsWith(q)) return 1
  if (t.includes(` ${q}`) || t.includes(`-${q}`)) return 2
  if (t.includes(q)) return 3
  return 4
}
