// The draft's live socket, at /api/ideas/{idea}/draft/live (the messages are DraftLiveClientMessage and
// DraftLiveEvent in @ideaf/api): typing in the idea's draft, for people who can edit it
// (docs/handoff-live-editing.md, step 3). It's apart from the idea's live socket (live.ts), which
// anyone who can see the idea holds: this one is open only while someone edits, and closes when
// their edit access goes.
//
// As on the idea's socket, the browser sends a token first, and a fresh one before it expires; each
// one is checked for editing the idea, so a person who can no longer edit is closed out (4403) by
// the next. This app node connects to the idea's actor and, for each file the browser has open,
// passes on the steps the actor stores, and every version made; the browser's messages are taken
// in the order they came.
//
// Each socket is a browser window, and joins the draft as one (the actor's presence.ts): it's told
// where everyone else's caret is, and theirs goes to everyone. Past the limit of windows
// (limits.draft.editors) it reads along without typing, and joins once someone leaves.
import {
  type Caller,
  DRAFT_LIVE_CLOSE,
  type DraftCaret,
  DraftLiveClientMessage,
  type DraftLiveEvent,
  operations,
  type TokenScope,
} from '@ideaf/api'
import type { Server, ServerWebSocket, WebSocketHandler } from 'bun'
import type { Client } from 'rivetkit/client'
import { directoryOf, ideaOf } from './actors/pools.ts'
import type { authGateway } from './auth/gateway.ts'
import { DEFAULT_DRAFT_LIMITS, type DraftLimits } from './limits.ts'
import { expiryOf } from './live.ts'
import type { Registry } from './registry.ts'

const PATH = /^\/api\/ideas\/([^/]+)\/draft\/live$/
/** How long a client has to send its first token. */
const FIRST_TOKEN_MS = 10_000
/** The longest a token counts for here, whatever its own expiry. */
const TOKEN_MS = 15 * 60_000

type IdeaHandle = ReturnType<Client<Registry>['idea']['getOrCreate']>
type Conn = ReturnType<IdeaHandle['connect']>

export interface DraftLiveData {
  kind: 'draft'
  idea: string
  user: string | null
  caller: Caller | null
  timer: ReturnType<typeof setTimeout> | null
  conn: Conn | null
  /** The browser window, as the draft knows it (from the first token message). */
  window: string | null
  /** This socket of the window: a reconnect's takes the window over. */
  session: string
  /** Whether the window's in the draft; outside it (the draft's full) it reads along without typing. */
  joined: boolean
  /** The files this browser has open: their steps are passed on. */
  files: Set<string>
  /** Messages are taken one after another, in the order they came. */
  queue: Promise<void>
}

type Socket = ServerWebSocket<DraftLiveData>
type Gateway = Pick<ReturnType<typeof authGateway>, 'authenticate'>

export function createDraftLive({
  actors,
  gateway,
  limits = DEFAULT_DRAFT_LIMITS,
}: {
  actors: Client<Registry>
  gateway: Gateway
  limits?: Pick<DraftLimits, 'editors' | 'caretMs'>
}) {
  const directory = () => directoryOf(actors)
  const send = (ws: Socket, event: DraftLiveEvent) => ws.send(JSON.stringify(event))
  const close = (ws: Socket, code: number, reason: string) => ws.close(code, reason)

  /** Who a token is for, and until when it counts here; null if it isn't valid for editing, `unavailable` if it can't be checked now. */
  const check = async (
    token: string,
  ): Promise<{ caller: Caller; scope: TokenScope | null; until: number } | 'unavailable' | null> => {
    const request = new Request('http://live/', { headers: { authorization: `Bearer ${token}` } })
    // checked as a change to the draft would be: a read-only token can't type
    const who = await gateway.authenticate(request, operations.changeDraft)
    if (who && 'code' in who && who.code === 'unavailable') {
      return 'unavailable'
    }
    if (!who || !('caller' in who)) {
      return null
    }
    return { caller: who.caller, scope: who.token, until: Math.min(expiryOf(token), Date.now() + TOKEN_MS) }
  }

  const expireAt = (ws: Socket, until: number) => {
    clearTimeout(ws.data.timer ?? undefined)
    ws.data.timer = setTimeout(
      () => close(ws, DRAFT_LIVE_CLOSE.unauthorized, 'token expired'),
      Math.max(0, until - Date.now()),
    )
  }

  /** The window into the draft, if there's room: whether it's in, and everyone who is. */
  const join = async (ws: Socket) => {
    const joined = await ws.data.conn!.presenceJoin(ws.data.window!, ws.data.user!, ws.data.session, limits.editors)
    ws.data.joined = joined.joined
    return joined
  }
  /** Messages taken one after another, in the order they came; the actor failing closes the socket. */
  const enqueue = (ws: Socket, work: () => Promise<unknown>) => {
    ws.data.queue = ws.data.queue
      .then(async () => {
        await work()
      })
      .catch(() => {
        // the actor couldn't be reached, or failed: the browser comes back and catches up
        close(ws, DRAFT_LIVE_CLOSE.unavailable, 'the draft is unavailable for a moment; reconnect')
      })
  }

  /** A token, first or fresh: whether its person may still edit the idea. */
  const token = async (ws: Socket, value: string, window: string) => {
    const who = await check(value)
    if (who === 'unavailable') {
      return close(ws, DRAFT_LIVE_CLOSE.unavailable, "tokens can't be checked right now; try again shortly")
    }
    if (!who || (ws.data.user !== null && who.caller.user !== ws.data.user)) {
      return close(ws, DRAFT_LIVE_CLOSE.unauthorized, 'not a valid token for this socket')
    }
    const permission = await directory().permission(ws.data.idea, who.caller.user, who.scope?.id ?? null)
    if (!permission.view) {
      return close(ws, DRAFT_LIVE_CLOSE.notFound, "this idea doesn't exist, or you can't see it")
    }
    if (!permission.edit) {
      return close(ws, DRAFT_LIVE_CLOSE.forbidden, 'you can no longer edit this idea')
    }
    expireAt(ws, who.until)
    // a fresh token for a socket that's already open: it just counts for longer
    if (ws.data.user !== null) {
      return
    }
    ws.data.user = who.caller.user
    ws.data.caller = who.caller
    ws.data.window = window
    const conn = ideaOf<IdeaHandle>(actors, ws.data.idea).connect()
    ws.data.conn = conn
    conn.on('draftSteps', (e) => {
      if (ws.data.files.has(e.file)) {
        send(ws, { type: 'steps', file: e.file, from: e.from, steps: e.steps, clients: e.clients })
      }
    })
    conn.on('version', (e) =>
      send(ws, { type: 'version', version: e.version, by: e.by, committed: e.committed, overwrote: e.overwrote }),
    )
    conn.on('draft', (e) => {
      if (e.discarded) {
        send(ws, { type: 'discarded', by: e.by })
      }
    })
    conn.on('presence', (person) => send(ws, { type: 'presence', person }))
    conn.on('presenceLeft', ({ window: gone }) => {
      send(ws, { type: 'left', window: gone })
      // room, maybe, for this window
      if (!ws.data.joined) {
        enqueue(ws, async () => {
          const joined = await join(ws)
          if (joined.joined) {
            send(ws, { type: 'joined', people: joined.people })
          }
        })
      }
    })
    const ready = () =>
      enqueue(ws, async () => {
        const joined = await join(ws)
        send(ws, {
          type: 'ready',
          joined: joined.joined,
          limit: limits.editors,
          caretMs: limits.caretMs,
          people: joined.people,
        })
      })
    if (conn.connStatus === 'connected') {
      ready()
    } else {
      const off = conn.onOpen(() => {
        off()
        ready()
      })
    }
  }

  /** Where this window's caret is: to everyone in the draft. Not in turn with the rest, so typing doesn't wait on it. */
  const here = (ws: Socket, at: DraftCaret | null) => {
    const conn = ws.data.conn
    if (!conn || !ws.data.joined) {
      return
    }
    conn.presenceMove(ws.data.window!, ws.data.session, at).then(
      (known) => {
        // the actor started again (or forgot a quiet window): in again, or out to come back
        if (!known) {
          enqueue(ws, async () => {
            if (!(await join(ws)).joined) {
              close(ws, DRAFT_LIVE_CLOSE.unavailable, 'the draft is unavailable for a moment; reconnect')
            }
          })
        }
      },
      () => close(ws, DRAFT_LIVE_CLOSE.unavailable, 'the draft is unavailable for a moment; reconnect'),
    )
  }

  const handle = async (ws: Socket, message: Exclude<DraftLiveClientMessage, { type: 'here' }>) => {
    if (message.type === 'token') {
      return token(ws, message.token, message.window)
    }
    const conn = ws.data.conn
    if (!conn || !ws.data.caller) {
      return close(ws, DRAFT_LIVE_CLOSE.unauthorized, 'send a token first')
    }
    if ((message.type === 'steps' || message.type === 'moved') && !ws.data.joined) {
      return send(ws, {
        type: 'refused',
        file: message.file,
        message: 'the draft is full: you can type once someone leaves',
      })
    }
    switch (message.type) {
      case 'open': {
        // passed on from now, so nothing stored after the document is read is missed
        ws.data.files.add(message.file)
        const opened = await conn.draftOpen(message.file)
        if (!opened) {
          ws.data.files.delete(message.file)
          return send(ws, { type: 'refused', file: message.file, message: 'the latest version has no such file' })
        }
        return send(ws, { type: 'opened', file: message.file, version: opened.version, doc: opened.doc })
      }
      case 'steps': {
        const result = await conn.draftTyping({
          file: message.file,
          version: message.version,
          steps: message.steps,
          client: message.client,
          caller: ws.data.caller,
          ...(ws.data.window ? { window: ws.data.window } : {}),
        })
        if (result.kind === 'behind') {
          return send(ws, { type: 'behind', file: message.file, version: result.version })
        }
        if (result.kind === 'refused') {
          return send(ws, { type: 'refused', file: message.file, message: result.message })
        }
        // taken: the steps come back to everyone, this browser too, as they're stored
        return
      }
      case 'moved':
        await conn.draftMoved(message.words, ws.data.caller)
        return
      case 'since': {
        const missed = await conn.draftSince(message.file, message.version)
        if (missed.kind === 'gone') {
          return send(ws, { type: 'gone', file: message.file })
        }
        return send(ws, {
          type: 'steps',
          file: message.file,
          from: missed.from,
          steps: missed.steps,
          clients: missed.clients,
        })
      }
    }
  }

  const websocket: WebSocketHandler<DraftLiveData> = {
    open(ws) {
      ws.data.timer = setTimeout(() => close(ws, DRAFT_LIVE_CLOSE.unauthorized, 'no token'), FIRST_TOKEN_MS)
    },
    message(ws, raw) {
      let message: DraftLiveClientMessage
      try {
        message = DraftLiveClientMessage.parse(JSON.parse(String(raw)))
      } catch {
        return close(ws, DRAFT_LIVE_CLOSE.unauthorized, 'expected a token, here, open, steps, since or moved message')
      }
      if (message.type === 'here') {
        return here(ws, message.at)
      }
      enqueue(ws, () => handle(ws, message))
    },
    close(ws) {
      clearTimeout(ws.data.timer ?? undefined)
      const conn = ws.data.conn
      if (!conn) {
        return
      }
      // out of the draft first (unless a reconnect has the window now), then the connection
      const leaving = ws.data.window ? conn.presenceLeave(ws.data.window, ws.data.session) : Promise.resolve()
      void leaving.catch(() => {}).finally(() => void conn.dispose())
    },
  }

  return {
    websocket,
    /** Upgrades a request for an idea's draft socket; null if the path isn't one. */
    upgrade(request: Request, server: Server<DraftLiveData>): Response | undefined | null {
      const match = PATH.exec(new URL(request.url).pathname)
      if (!match) {
        return null
      }
      const idea = decodeURIComponent(match[1]!)
      const data: DraftLiveData = {
        kind: 'draft',
        idea,
        user: null,
        caller: null,
        timer: null,
        conn: null,
        window: null,
        session: crypto.randomUUID(),
        joined: false,
        files: new Set(),
        queue: Promise.resolve(),
      }
      if (server.upgrade(request, { data })) {
        return undefined
      }
      return new Response('This is a WebSocket: connect with one.', { status: 426, headers: { upgrade: 'websocket' } })
    },
  }
}
