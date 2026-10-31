// One actor per idea: a thin shell around IdeaService. Writes come through the
// queue and are applied one at a time, in order; reads are actions and run in
// parallel against the latest committed state. After each write, its events go
// to everyone connected (live updates).
import { actor, event, queue, UserError } from 'rivetkit'
import { db } from 'rivetkit/db'
import { nodeDeps } from '../deps.ts'
import { migrate } from '../idea/schema.ts'
import { type IdeaEvent, IdeaService, Refused, type WriteRequest, type WriteResult } from '../idea/service.ts'

type Payload<N extends IdeaEvent['name']> = Extract<IdeaEvent, { name: N }>['payload']

export const idea = actor({
  db: db({ onMigrate: (database) => migrate(database) }),
  events: {
    version: event<Payload<'version'>>(),
    comment: event<Payload<'comment'>>(),
    resolved: event<Payload<'resolved'>>(),
  },
  queues: {
    writes: queue<WriteRequest, WriteResult>(),
  },
  createVars: () => ({ service: null as IdeaService | null }),
  run: async (c) => {
    const service = serviceOf(c)
    for await (const message of c.queue.iter({ completable: true })) {
      try {
        const { result, events } = await service.write(message.body)
        for (const e of events) c.broadcast(e.name, e.payload)
        await message.complete(result)
      } catch (error) {
        c.log.error({ msg: 'idea write failed', error: String(error) })
        await message.complete({ ok: false, error: { code: 'invalid', message: 'the write failed on the server; retry it with the same key' } })
      }
    }
  },
  actions: {
    summary: (c) => read(() => serviceOf(c).summary()),
    files: (c, version?: number) => read(() => serviceOf(c).files(version)),
    file: (c, version: number | undefined, file: string) => read(() => serviceOf(c).file(version, file)),
    outline: (c, version?: number) => read(() => serviceOf(c).outline(version)),
    comments: (c, version?: number) => read(() => serviceOf(c).comments(version)),
    steps: (c, version: number) => read(() => serviceOf(c).steps(version)),
    preview: (c, batch: unknown) => read(() => serviceOf(c).preview(batch)),
  },
})

function serviceOf(c: { key: readonly string[]; db: Parameters<typeof migrate>[0]; vars: { service: IdeaService | null } }): IdeaService {
  if (!c.vars.service) c.vars.service = new IdeaService(c.key[0]!, { sql: c.db, ...nodeDeps() })
  return c.vars.service
}

async function read<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof Refused) throw new UserError(error.message, { code: error.error.code, metadata: error.error.details })
    throw error
  }
}
