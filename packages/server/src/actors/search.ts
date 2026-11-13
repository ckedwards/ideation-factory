// The search index of ideas' titles, in an actor of its own (directory/search.ts
// says why): searches run here beside the directory instead of taking turns on
// its one connection. The directory sends titles as ideas are registered and
// updated, through the queue, many to a commit; and asks for matching IDs.
import { actor, queue } from 'rivetkit'
import { db } from 'rivetkit/db'
import { fts5Search, type IdeaSearch, migrateSearch } from '../directory/search.ts'
import { callRetrying, overloadedRetryMs, retryOverloaded } from '../sql/retry.ts'

export const SEARCH_KEY = ['main']

type Entries = Array<{ id: string; title: string }>

export const search = actor({
  db: db({ onMigrate: (database) => migrateSearch(database) }),
  queues: { index: queue<Entries>() },
  createVars: () => ({ index: null as IdeaSearch | null }),
  run: async (c) => {
    const index = indexOf(c)
    while (!c.aborted) {
      let batch: Awaited<ReturnType<typeof c.queue.nextBatch>>
      try {
        batch = await c.queue.nextBatch({ count: 50, completable: true, timeout: 30_000 })
      } catch (error) {
        if (c.aborted) {
          return
        }
        // the queue's own table is in the actor's storage, which can be busy for a moment
        c.log.error({ msg: 'reading the queue failed; trying again', error: String(error) })
        await Bun.sleep(Math.min(overloadedRetryMs(error) ?? 500, 2_000))
        continue
      }
      if (batch.length === 0) {
        continue
      }
      // a batch in one commit, in the order sent, so the last update of an idea is the one kept
      try {
        await index.index(batch.flatMap((m) => m.body as Entries))
      } catch (error) {
        c.log.error({ msg: 'indexing failed', error: String(error) })
      }
      for (const message of batch) {
        await callRetrying(() => message.complete())
      }
    }
  },
  actions: {
    matches: (c, terms: string[], cap: number) => indexOf(c).matches(terms, cap),
  },
})

function indexOf(c: { db: Parameters<typeof migrateSearch>[0]; vars: { index: IdeaSearch | null } }): IdeaSearch {
  // the engine refuses writes for a moment when storage is busy: wait and retry
  c.vars.index ??= fts5Search(retryOverloaded(c.db))
  return c.vars.index
}
