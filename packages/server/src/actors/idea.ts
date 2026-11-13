// One actor per idea: a thin shell around IdeaService. Writes come through the
// queue and are applied one at a time, in order; reads are actions and run in
// parallel against the latest committed state. After each write, its events go
// to everyone connected (live updates), and what it tells inboxes, kept in the
// outbox by the write's own transaction, goes to the directory until it says
// it has applied it: a committed write's notifications are never lost.
import { actor, event, UserError } from 'rivetkit'
import { db } from 'rivetkit/db'
import { nodeDeps } from '../deps.ts'
import { sendOutbox } from '../idea/outbox.ts'
import { migrate } from '../idea/schema.ts'
import { type IdeaEvent, IdeaService, Refused, type WriteRequest, type WriteResult } from '../idea/service.ts'
import type { Client } from 'rivetkit/client'
import type { Registry } from '../registry.ts'
import { callRetrying, retryOverloaded } from '../sql/retry.ts'
import { batcher } from './batch.ts'
import { directoryOf } from './pools.ts'

/**
 * How long an idea waits before updating its row in the directory's index, so a
 * burst of activity (a bot posting many comments) is one index write, not many
 * (scale concern 1).
 */
const indexDelayMs = () => Number(process.env.IDEAF_INDEX_DELAY_MS ?? 2000)

type Payload<N extends IdeaEvent['name']> = Extract<IdeaEvent, { name: N }>['payload']

export const idea = actor({
  db: db({ onMigrate: (database) => migrate(database) }),
  events: {
    version: event<Payload<'version'>>(),
    comment: event<Payload<'comment'>>(),
    reply: event<Payload<'reply'>>(),
    resolved: event<Payload<'resolved'>>(),
    decided: event<Payload<'decided'>>(),
    draft: event<Payload<'draft'>>(),
    status: event<Payload<'status'>>(),
    review: event<Payload<'review'>>(),
  },
  state: { indexDue: false, lastActivity: 0 },
  createVars: () => ({
    service: null as IdeaService | null,
    flushing: null as Promise<void> | null,
    again: false,
    alarmAt: 0,
    writes: null as ((request: WriteRequest) => Promise<WriteResult>) | null,
  }),
  onWake: (c) => {
    // one write at a time, in the order they came (actors/batch.ts), with this wake-up's context
    c.vars.writes = writerOf(c)
    // what a stopped actor hadn't sent yet goes now
    void c.keepAwake(flushOutbox(c))
  },
  actions: {
    /**
     * A write (idea/service.ts), answered once it stands; one at a time, as each builds on the version before.
     * Its key makes a retry return the same answer.
     */
    write: (c, request: WriteRequest) => (c.vars.writes ??= writerOf(c))(request),
    summary: (c) => read(() => serviceOf(c).summary()),
    files: (c, version?: number) => read(() => serviceOf(c).files(version)),
    pull: (c, version?: number) => read(() => serviceOf(c).pull(version)),
    file: (c, version: number | undefined, file: string) => read(() => serviceOf(c).file(version, file)),
    outline: (c, version?: number) => read(() => serviceOf(c).outline(version)),
    /** `viewer`: whose pending comments to include (reviewerOf); nobody's otherwise. */
    comments: (c, version?: number, viewer?: string | null) => read(() => serviceOf(c).comments(version, viewer)),
    steps: (c, version: number) => read(() => serviceOf(c).steps(version)),
    preview: (c, batch: unknown) => read(() => serviceOf(c).preview(batch)),
    draft: (c) => read(() => serviceOf(c).draft()),
    reviews: (c, viewer?: string | null) => read(() => serviceOf(c).reviews(viewer)),
    suggestionSource: (c, file: string, start: number, end: number) =>
      read(() => serviceOf(c).suggestionSource(file, start, end)),
    /** Sends this idea's current index row to the directory, without waiting (scheduled after a write). */
    /** Sends what the outbox holds (the alarms outboxAlarm sets call it). */
    flushOutbox: (c) => flushOutbox(c),
    /** How many of this idea's notifications haven't reached the directory yet. */
    outboxSize: (c) => serviceOf(c).outboxSize(),
    flushIndex: async (c) => {
      c.state.indexDue = false
      const summary = await serviceOf(c).summary()
      if (!summary) {
        return
      }
      const update = {
        id: summary.id,
        title: summary.title,
        description: summary.description,
        status: summary.status,
        latest: summary.latest,
        openComments: await serviceOf(c).openComments(),
        updatedAt: c.state.lastActivity || Date.now(),
      }
      // an index update is safe to send twice: the newest wins. Should it fail, it's sent again later
      try {
        await callRetrying(() => directoryOf(c.client<Registry>()).index(update))
      } catch (error) {
        c.log.error({ msg: 'updating the index failed; trying again', error: String(error) })
        c.state.indexDue = true
        await c.schedule.after(30_000, 'flushIndex')
      }
    },
  },
})

function serviceOf(c: {
  key: readonly string[]
  db: Parameters<typeof migrate>[0]
  vars: { service: IdeaService | null }
}): IdeaService {
  if (!c.vars.service) {
    // the engine refuses writes for a moment when storage is busy: wait and retry
    c.vars.service = new IdeaService(c.key[0]!, { sql: retryOverloaded(c.db), ...nodeDeps() })
  }
  return c.vars.service
}

async function read<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof Refused) {
      throw new UserError(error.message, { code: error.error.code, metadata: error.error.details })
    }
    throw error
  }
}

/** The most writes that may wait for the one before them (what the write queue allowed). */
const WAITING_WRITES = 1_000

type WriteContext = OutboxContext & {
  state: { indexDue: boolean; lastActivity: number }
  broadcast(name: string, payload: unknown): void
  keepAwake<T>(promise: Promise<T>): Promise<T>
  schedule: OutboxContext['schedule'] & { after(duration: number, action: string, ...args: unknown[]): Promise<string> }
}

/** Writes applied one at a time: each is checked against the version before it, so none may run beside another. */
function writerOf(c: WriteContext): (request: WriteRequest) => Promise<WriteResult> {
  return batcher(async ([request]: WriteRequest[]) => [await applyWrite(c, request!)], {
    max: 1,
    waiting: WAITING_WRITES,
  })
}

async function applyWrite(c: WriteContext, request: WriteRequest): Promise<WriteResult> {
  let written: Awaited<ReturnType<IdeaService['write']>>
  try {
    written = await serviceOf(c).write(request)
  } catch (error) {
    c.log.error({ msg: 'idea write failed', error: String(error) })
    return {
      ok: false,
      error: { code: 'invalid', message: 'the write failed on the server; retry it with the same key' },
    }
  }
  const { result, events } = written
  for (const e of events) {
    c.broadcast(e.name, e.payload)
  }
  // the write stands from here: what follows can't undo it, so its failures are logged, not returned.
  // Its notifications are in the outbox already; send them now, with an alarm in case this stops first.
  try {
    await outboxAlarm(c, Date.now() + OUTBOX_SAFETY_MS)
  } catch (error) {
    c.log.error({ msg: 'setting the outbox alarm failed', error: String(error) })
  }
  void c.keepAwake(flushOutbox(c))
  try {
    if (events.length > 0) {
      c.state.lastActivity = Date.now()
      if (!c.state.indexDue) {
        c.state.indexDue = true
        await c.schedule.after(indexDelayMs(), 'flushIndex')
      }
    }
  } catch (error) {
    c.log.error({ msg: 'scheduling the index update failed', error: String(error) })
  }
  return result
}

/** How long after a write the safety alarm goes, should the actor stop before its outbox is sent. */
const OUTBOX_SAFETY_MS = 30_000

type OutboxContext = {
  key: readonly string[]
  db: Parameters<typeof migrate>[0]
  vars: { service: IdeaService | null; flushing: Promise<void> | null; again: boolean; alarmAt: number }
  log: { error: (fields: Record<string, unknown>) => void }
  schedule: {
    at(timestamp: number, action: string, ...args: unknown[]): Promise<string>
    list(): Promise<Array<{ action: string; runAt: number }>>
  }
  client: () => unknown
}

/** An alarm to send the outbox at `at`, unless one is set for then or sooner. */
async function outboxAlarm(c: OutboxContext, at: number): Promise<void> {
  if (c.vars.alarmAt > Date.now() && c.vars.alarmAt <= at) {
    return
  }
  const set = (await c.schedule.list()).find((e) => e.action === 'flushOutbox' && e.runAt > Date.now() && e.runAt <= at)
  if (!set) {
    await c.schedule.at(at, 'flushOutbox')
  }
  c.vars.alarmAt = set?.runAt ?? at
}

/**
 * Sends the outbox to the directory (idea/outbox.ts), each notification
 * waiting until the directory has applied it, with an alarm for when the
 * next is due should any be left.
 */
function flushOutbox(c: OutboxContext): Promise<void> {
  // one flush at a time; one asked for meanwhile runs after it, so nothing written meanwhile waits for an alarm
  if (c.vars.flushing) {
    c.vars.again = true
    return c.vars.flushing
  }
  c.vars.again = false
  c.vars.flushing = (async () => {
    try {
      const directory = directoryOf((c.client as () => Client<Registry>)())
      const next = await sendOutbox(
        serviceOf(c),
        async (batch) => {
          const sent = await directory.notify({ idea: c.key[0]!, ...batch })
          return sent.ok
        },
        (fields) => c.log.error(fields),
      )
      if (next !== null) {
        await outboxAlarm(c, Math.max(next, Date.now() + 100))
      }
    } catch (error) {
      c.log.error({ msg: 'flushing the outbox failed', error: String(error) })
    } finally {
      c.vars.flushing = null
    }
    if (c.vars.again) {
      await flushOutbox(c)
    }
  })()
  return c.vars.flushing
}
