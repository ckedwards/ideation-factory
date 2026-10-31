// Searching ideas, behind its own interface because it's what differs most
// between databases: FTS5 with the trigram tokenizer here, pg_trgm for the
// Postgres escape hatch. Candidates come from the index; ranking by closeness
// stays in our code, so it's the same everywhere.
import type { Kysely } from 'kysely'
import { sql as raw } from 'kysely'
import type { Sql } from '../idea/sql.ts'
import type { DB } from './schema.ts'

export interface IdeaSearch {
  migrate(sql: Sql): Promise<void>
  /** Keeps an idea's searchable text current; called in the same transaction as its index row. */
  index(db: Kysely<DB>, id: string, title: string): Promise<void>
  /** Idea IDs that may match, best first, at most `limit`. */
  candidates(db: Kysely<DB>, query: string, limit: number): Promise<string[]>
}

/** Text in a trigram index needs three characters; shorter searches match from the start of a word. */
export const MIN_INCLUDES = 3

export function fts5Search(): IdeaSearch {
  return {
    async migrate(sql) {
      await sql.execute("CREATE VIRTUAL TABLE IF NOT EXISTS idea_search USING fts5(id UNINDEXED, title, tokenize = 'trigram')")
    },
    async index(db, id, title) {
      await raw`DELETE FROM idea_search WHERE id = ${id}`.execute(db)
      await raw`INSERT INTO idea_search (id, title) VALUES (${id}, ${title})`.execute(db)
    },
    async candidates(db, query, limit) {
      const terms = query.trim().split(/\s+/).filter(Boolean)
      if (terms.length === 0) return []
      if (terms.every((t) => t.length >= MIN_INCLUDES)) {
        const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ')
        const rows = await raw<{ id: string }>`SELECT id FROM idea_search WHERE idea_search MATCH ${match} ORDER BY bm25(idea_search) LIMIT ${limit}`.execute(db)
        return rows.rows.map((r) => r.id)
      }
      // short input: titles where a word starts with it
      // LIKE's wildcards are dropped from the input (escaping them differs between SQLite and Postgres)
      const q = terms.join(' ').toLowerCase().replace(/[%_\\]/g, '')
      const rows = await db
        .selectFrom('ideas')
        .select('id')
        .where((eb) => eb.or([eb(eb.fn('lower', ['title']), 'like', `${q}%`), eb(eb.fn('lower', ['title']), 'like', `% ${q}%`)]))
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .execute()
      return rows.map((r) => r.id)
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
