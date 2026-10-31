// One actor per idea. Every write goes through the idea's queue, so writes are
// applied one at a time, in order, with no locks; reads are plain actions and
// run in parallel. Step 2 of the build plan replaces this placeholder state
// with versions, comments and edit batches, kept in a plain IdeaService with
// this actor as a thin shell.
import { actor, queue } from 'rivetkit'

export type IdeaWrite = { type: 'set-title'; title: string }
export type IdeaWriteResult = { ok: true; writes: number } | { ok: false; error: string }

export const idea = actor({
  state: { title: null as string | null, writes: 0 },
  queues: {
    writes: queue<IdeaWrite, IdeaWriteResult>(),
  },
  run: async (c) => {
    for await (const message of c.queue.iter({ completable: true })) {
      const write = message.body
      if (write.type === 'set-title') {
        const title = write.title.trim()
        if (!title) {
          await message.complete({ ok: false, error: 'title_empty' })
          continue
        }
        c.state.title = title
        c.state.writes += 1
        await message.complete({ ok: true, writes: c.state.writes })
      }
    }
  },
  actions: {
    get: (c) => ({ title: c.state.title, writes: c.state.writes }),
  },
})
