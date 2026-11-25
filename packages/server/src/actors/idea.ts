// One actor per idea: a thin shell around IdeaService. Writes come through the
// queue and are applied one at a time, in order; reads are actions and run in
// parallel against the latest committed state. After each write, its events go
// to everyone connected (live updates), and what it tells inboxes, kept in the
// outbox by the write's own transaction, goes to the directory until it says
// it has applied it: a committed write's notifications are never lost.
import type { DraftCaret, DraftPresence } from '@ideaf/api'
import type { MovedWords } from '@ideaf/core'
import { actor, event, UserError } from 'rivetkit'
import { db } from 'rivetkit/db'
import { nodeDeps } from '../deps.ts'
import { sendOutbox } from '../idea/outbox.ts'
import { migrate } from '../idea/schema.ts'
import {
  type IdeaEvent,
  IdeaService,
  Refused,
  type Typing,
  type TypingResult,
  type WriteRequest,
  type WriteResult,
} from '../idea/service.ts'
import type { Client } from 'rivetkit/client'
import type { Registry } from '../registry.ts'
import { callRetrying, retryOverloaded } from '../sql/retry.ts'
import { batcher } from './batch.ts'
import { directoryOf } from './pools.ts'
import { DraftPresences, type Joined, PRESENCE_TTL_MS } from './presence.ts'

/** How recently a window has to have typed to be typing "now", for the commit dialog. */
const TYPING_NOW_MS = 5000

/**
 * How long an idea waits before updating its row in the directory's index, so a
 * burst of activity (a bot posting many comments) is one index write, not many
 * (scale concern 1).
 */
const indexDelayMs = () => Number(process.env.IDEAF_INDEX_DELAY_MS ?? 2000)

/**
 * How often, at most, typing tells the idea's pages that the draft changed (its `draft` event): they
 * read the draft again for its list of changes. Editors have the steps themselves (`draftSteps`).
 */
const TYPING_DRAFT_EVENT_MS = 1000

type Payload<N extends IdeaEvent['name']> = Extract<IdeaEvent, { name: N }>['payload']

export const idea = actor({
  db: db({ onMigrate: (database) => migrate(database) }),
  events: {
    version: event<Payload<'version'>>(),
    comment: event<Payload<'comment'>>(),
    reply: event<Payload<'reply'>>(),
    resolved: event<Payload<'resolved'>>(),
    decided: event<Payload<'decided'>>(),
    /** The draft changed, and whether it has uncommitted changes now (for pages of people who can't open it). */
    draft: event<Payload<'draft'> & { uncommitted: boolean }>(),
    status: event<Payload<'status'>>(),
    review: event<Payload<'review'>>(),
    draftSteps: event<Payload<'draftSteps'>>(),
    /** A window arrived in the draft, or its caret moved (presence.ts): to the draft's sockets only. */
    presence: event<DraftPresence>(),
    /** A window left the draft. */
    presenceLeft: event<{ window: string }>(),
  },
  state: { indexDue: false, lastActivity: 0 },
  createVars: () => ({
    service: null as IdeaService | null,
    flushing: null as Promise<void> | null,
    again: false,
    alarmAt: 0,
    writes: null as ((task: Task) => Promise<WriteResult | TypingResult | Opened>) | null,
    // typing's draft event: when it last went, and the one waiting to go
    draftEventAt: 0,
    draftEventTimer: null as ReturnType<typeof setTimeout> | null,
    // who's in the draft and where (presence.ts): memory only, and the sweep for windows gone quiet
    presence: new DraftPresences(),
    presenceSweep: null as ReturnType<typeof setTimeout> | null,
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
    write: (c, request: WriteRequest) =>
      (c.vars.writes ??= writerOf(c))({ kind: 'write', request }) as Promise<WriteResult>,
    /**
     * A file of the draft opened to edit (the draft's live socket, draft-live.ts): its document and the
     * count of its steps; null if the latest version has no such file. In the write queue, as it may
     * make the file a draft file.
     */
    draftOpen: (c, file: string) => (c.vars.writes ??= writerOf(c))({ kind: 'open', file }) as Promise<Opened>,
    /**
     * Typing: an editor's steps on the count it had, taken in the write queue's turn. A send behind the
     * count already is answered at once, without waiting for a turn: it would be refused in it.
     */
    draftTyping: (c, typing: Typing): Promise<TypingResult> => {
      if (typing.window) {
        c.vars.presence.typed(typing.window, Date.now())
      }
      const count = serviceOf(c).behind(typing.file, typing.version)
      if (count !== null) {
        return Promise.resolve({ kind: 'behind', version: count })
      }
      return (c.vars.writes ??= writerOf(c))({ kind: 'typing', typing }) as Promise<TypingResult>
    },
    /** Words an editor saw moved between blocks, in the write queue's turn: the draft counts them as moved. */
    draftMoved: (c, words: MovedWords, caller: Typing['caller']) =>
      (c.vars.writes ??= writerOf(c))({ kind: 'moved', words, caller }) as Promise<null>,
    /**
     * A window coming into the draft (a draft socket, on its token): let in unless `limit` windows are
     * in, and everyone in it. Memory only, so outside the write queue.
     */
    presenceJoin: (c, window: string, user: string, session: string, limit: number): Joined => {
      sweepPresence(c)
      const joined = c.vars.presence.join(window, user, session, limit, Date.now())
      if (joined.joined) {
        c.broadcast('presence', joined.person)
      }
      armPresenceSweep(c)
      return joined
    },
    /** A window's caret, or that it's still there: false if it isn't in (the actor started again, say). */
    presenceMove: (c, window: string, session: string, at: DraftCaret | null): boolean => {
      const moved = c.vars.presence.move(window, session, at, Date.now())
      if (moved?.moved) {
        c.broadcast('presence', moved.person)
      }
      return moved !== null
    },
    /** A window's socket closed. */
    presenceLeave: (c, window: string, session: string): void => {
      if (c.vars.presence.leave(window, session)) {
        c.broadcast('presenceLeft', { window })
      }
    },
    /** What an editor missed in a file since its count, if it's still kept. */
    draftSince: (c, file: string, version: number) => read(() => serviceOf(c).draftSince(file, version)),
    summary: (c) => read(() => serviceOf(c).summary()),
    files: (c, version?: number) => read(() => serviceOf(c).files(version)),
    pull: (c, version?: number) => read(() => serviceOf(c).pull(version)),
    file: (c, version: number | undefined, file: string) => read(() => serviceOf(c).file(version, file)),
    outline: (c, version?: number) => read(() => serviceOf(c).outline(version)),
    /** `viewer`: whose pending comments to include (reviewerOf); nobody's otherwise. */
    comments: (c, version?: number, viewer?: string | null) => read(() => serviceOf(c).comments(version, viewer)),
    steps: (c, version: number) => read(() => serviceOf(c).steps(version)),
    preview: (c, batch: unknown) => read(() => serviceOf(c).preview(batch)),
    /** The draft, and who is typing in it now and where (presence is the actor's, in memory). */
    draft: (c) =>
      read(async () => {
        const service = serviceOf(c)
        const draft = await service.draft()
        return { ...draft, typing: service.typingIn(c.vars.presence.typing(Date.now(), TYPING_NOW_MS)) }
      }),
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
      // the people whose approvals count, for lists: approvals of the latest version, so a new one clears them
      const approvers = (await serviceOf(c).reviews(null)).reviews.flatMap((r) => (r.counts ? [r.by.user] : []))
      const update = {
        id: summary.id,
        title: summary.title,
        description: summary.description,
        status: summary.status,
        latest: summary.latest,
        openComments: await serviceOf(c).openComments(),
        approvers,
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

type PresenceContext = {
  vars: { presence: DraftPresences; presenceSweep: ReturnType<typeof setTimeout> | null }
  broadcast(name: string, payload: unknown): void
}

/** Windows not heard from in a while taken out of the draft, and everyone told. */
function sweepPresence(c: PresenceContext): void {
  for (const window of c.vars.presence.sweep(Date.now())) {
    c.broadcast('presenceLeft', { window })
  }
}

/** The sweep, every third of the expiry while anyone's in the draft. */
function armPresenceSweep(c: PresenceContext): void {
  if (c.vars.presenceSweep || c.vars.presence.size === 0) {
    return
  }
  c.vars.presenceSweep = setTimeout(() => {
    c.vars.presenceSweep = null
    sweepPresence(c)
    armPresenceSweep(c)
  }, PRESENCE_TTL_MS / 3)
}

/** An event to everyone connected: the draft's with whether it has uncommitted changes now. */
async function broadcastEvent(c: WriteContext, e: IdeaEvent): Promise<void> {
  if (e.name === 'draft') {
    c.broadcast('draft', { ...e.payload, uncommitted: await serviceOf(c).uncommitted() })
    return
  }
  c.broadcast(e.name, e.payload)
}

/** The most writes that may wait for the one before them (what the write queue allowed). */
const WAITING_WRITES = 1_000

type WriteContext = OutboxContext & {
  state: { indexDue: boolean; lastActivity: number }
  vars: OutboxContext['vars'] & {
    draftEventAt: number
    draftEventTimer: ReturnType<typeof setTimeout> | null
  }
  broadcast(name: string, payload: unknown): void
  keepAwake<T>(promise: Promise<T>): Promise<T>
  schedule: OutboxContext['schedule'] & { after(duration: number, action: string, ...args: unknown[]): Promise<string> }
}

/** What the write queue takes: a write, a file of the draft opened to edit, or typing in one. */
type Task =
  | { kind: 'write'; request: WriteRequest }
  | { kind: 'open'; file: string }
  | { kind: 'typing'; typing: Typing }
  | { kind: 'moved'; words: MovedWords; caller: Typing['caller'] }

type Opened = { version: number; doc: unknown } | null

/**
 * Writes applied one at a time: each is checked against the version before it, so none may run
 * beside another. The draft's typing takes its turn with them.
 */
function writerOf(c: WriteContext): (task: Task) => Promise<WriteResult | TypingResult | Opened> {
  return batcher<Task, WriteResult | TypingResult | Opened>(
    async ([task]: Task[]) => {
      switch (task!.kind) {
        case 'write':
          return [await applyWrite(c, task!.request)]
        case 'open':
          return [await read(() => serviceOf(c).openDraftFile(task!.file))]
        case 'typing':
          return [await applyTyping(c, task!.typing)]
        case 'moved':
          await serviceOf(c).movedWords(task!.words, task!.caller)
          draftEventSoon(c, task!.caller)
          return [null]
      }
    },
    { max: 1, waiting: WAITING_WRITES },
  )
}

/** Typing stored, its steps sent to every editor, and the draft event to its pages, at most once a second. */
async function applyTyping(c: WriteContext, typing: Typing): Promise<TypingResult> {
  const { result, events } = await serviceOf(c).typing(typing)
  for (const e of events) {
    c.broadcast(e.name, e.payload)
  }
  if (result.kind === 'taken') {
    c.state.lastActivity = Date.now()
    draftEventSoon(c, typing.caller)
  }
  return result
}

function draftEventSoon(c: WriteContext, by: Typing['caller']): void {
  if (c.vars.draftEventTimer) {
    return
  }
  const send = () => {
    c.vars.draftEventTimer = null
    c.vars.draftEventAt = Date.now()
    void broadcastEvent(c, { name: 'draft', payload: { by } }).catch((error: unknown) =>
      c.log.error({ msg: 'the draft event failed', error: String(error) }),
    )
  }
  const wait = c.vars.draftEventAt + TYPING_DRAFT_EVENT_MS - Date.now()
  if (wait <= 0) {
    send()
  } else {
    c.vars.draftEventTimer = setTimeout(send, wait)
  }
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
    await broadcastEvent(c, e)
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
