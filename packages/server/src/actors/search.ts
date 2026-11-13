// The search index of ideas' titles, in an actor of its own (directory/search.ts
// says why): searches run here beside the directory instead of taking turns on
// its one connection. The directory sends titles as ideas are registered and
// updated, many calls to a commit; and asks for matching IDs.
import { actor } from 'rivetkit'
import { db } from 'rivetkit/db'
import { fts5Search, type IdeaSearch, migrateSearch } from '../directory/search.ts'
import { retryOverloaded } from '../sql/retry.ts'
import { batcher } from './batch.ts'

export { SEARCH_KEY } from './pools.ts'

type Entries = Array<{ id: string; title: string }>

export const search = actor({
  db: db({ onMigrate: (database) => migrateSearch(database) }),
  createVars: () => ({ index: null as IdeaSearch | null, apply: null as ((entries: Entries) => Promise<void>) | null }),
  actions: {
    // titles from the directory, many calls to a commit (actors/batch.ts), in the order sent, so the last
    // update of an idea is the one kept; answered once applied, so the directory can send again if not
    index: (c, entries: Entries) => (c.vars.apply ??= applierOf(c))(entries),
    matches: (c, terms: string[], cap: number) => indexOf(c).matches(terms, cap),
  },
})

/** The most calls a batch applies at once, and the most that may wait (what the queue allowed). */
const BATCHES = { max: 50, waiting: 1_000 }

function applierOf(c: Parameters<typeof indexOf>[0]): (entries: Entries) => Promise<void> {
  const index = indexOf(c)
  return batcher(async (calls: Entries[]) => {
    await index.index(calls.flat())
    return calls.map(() => undefined)
  }, BATCHES)
}

function indexOf(c: {
  db: Parameters<typeof migrateSearch>[0]
  vars: { index: IdeaSearch | null; apply: ((entries: Entries) => Promise<void>) | null }
}): IdeaSearch {
  // the engine refuses writes for a moment when storage is busy: wait and retry
  c.vars.index ??= fts5Search(retryOverloaded(c.db))
  return c.vars.index
}
