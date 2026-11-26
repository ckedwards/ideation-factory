// Live updates for one idea over a WebSocket, at /api/ideas/{idea}/live (the
// messages are LiveClientMessage and LiveEvent in @ideaf/api).
//
// The browser can't reach the idea's actor itself, so this app node does: it
// checks the token the client sends first (as a request's would be checked),
// and that its person can see the idea, then connects to the actor and passes
// on what it broadcasts. A token counts for 15 minutes at most, so a revoked
// one stops here as it would anywhere else: the client sends a fresh one
// before then, or the socket closes.
import { type Caller, LIVE_CLOSE, LiveClientMessage, type LiveEvent, operations, type TokenScope } from '@ideaf/api'
import type { Server, ServerWebSocket, WebSocketHandler } from 'bun'
import type { Client } from 'rivetkit/client'
import { directoryOf, ideaOf } from './actors/pools.ts'
import type { authGateway } from './auth/gateway.ts'
import type { Registry } from './registry.ts'

const PATH = /^\/api\/ideas\/([^/]+)\/live$/
/** How long a client has to send its first token. */
const FIRST_TOKEN_MS = 10_000
/** The longest a token counts for here, whatever its own expiry. */
const TOKEN_MS = 15 * 60_000

export interface LiveData {
  kind: 'idea'
  idea: string
  user: string | null
  timer: ReturnType<typeof setTimeout> | null
  conn: { dispose(): Promise<void> } | null
}

type Socket = ServerWebSocket<LiveData>
type Gateway = Pick<ReturnType<typeof authGateway>, 'authenticate'>

export function createLive({ actors, gateway }: { actors: Client<Registry>; gateway: Gateway }) {
  const directory = () => directoryOf(actors)
  const send = (ws: Socket, event: LiveEvent) => ws.send(JSON.stringify(event))
  const close = (ws: Socket, code: number, reason: string) => ws.close(code, reason)

  /** Who a token is for, and until when it counts here; null if it isn't valid, `unavailable` if it can't be checked now. */
  const check = async (
    token: string,
  ): Promise<{ caller: Caller; scope: TokenScope | null; until: number } | 'unavailable' | null> => {
    const request = new Request('http://live/', { headers: { authorization: `Bearer ${token}` } })
    const who = await gateway.authenticate(request, operations.getIdea)
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
      () => close(ws, LIVE_CLOSE.unauthorized, 'token expired'),
      Math.max(0, until - Date.now()),
    )
  }

  const websocket: WebSocketHandler<LiveData> = {
    open(ws) {
      ws.data.timer = setTimeout(() => close(ws, LIVE_CLOSE.unauthorized, 'no token'), FIRST_TOKEN_MS)
    },
    async message(ws, raw) {
      let message: LiveClientMessage
      try {
        message = LiveClientMessage.parse(JSON.parse(String(raw)))
      } catch {
        return close(ws, LIVE_CLOSE.unauthorized, 'expected {"type":"token","token":…}')
      }
      const who = await check(message.token)
      if (who === 'unavailable') {
        return close(ws, LIVE_CLOSE.unavailable, "tokens can't be checked right now; try again shortly")
      }
      if (!who || (ws.data.user !== null && who.caller.user !== ws.data.user)) {
        return close(ws, LIVE_CLOSE.unauthorized, 'not a valid token for this socket')
      }
      // a fresh token for a socket that's already open: it just counts for longer
      if (ws.data.user !== null) {
        return expireAt(ws, who.until)
      }
      const permission = await directory().permission(ws.data.idea, who.caller.user, who.scope?.id ?? null)
      if (!permission.view) {
        return close(ws, LIVE_CLOSE.notFound, "this idea doesn't exist, or you can't see it")
      }
      ws.data.user = who.caller.user
      expireAt(ws, who.until)
      const conn = ideaOf(actors, ws.data.idea).connect()
      ws.data.conn = conn
      conn.on('comment', (e) => send(ws, { type: 'comment', ...e }))
      conn.on('reply', (e) => send(ws, { type: 'reply', ...e }))
      conn.on('resolved', (e) => send(ws, { type: 'resolved', ...e }))
      conn.on('decided', (e) => send(ws, { type: 'decided', ...e }))
      conn.on('draft', (e) => send(ws, { type: 'draft', ...e }))
      conn.on('restorePoints', (e) => send(ws, { type: 'restorePoints', ...e }))
      conn.on('status', (e) => send(ws, { type: 'status', ...e }))
      conn.on('review', (e) => send(ws, { type: 'review', ...e }))
      conn.on('version', (e) => send(ws, { type: 'version', ...e }))
      // ready once events will arrive: the client reads what it shows after this
      const ready = () => send(ws, { type: 'ready' })
      if (conn.connStatus === 'connected') {
        ready()
      } else {
        const off = conn.onOpen(() => {
          off()
          ready()
        })
      }
    },
    close(ws) {
      clearTimeout(ws.data.timer ?? undefined)
      void ws.data.conn?.dispose()
    },
  }

  return {
    websocket,
    /** Upgrades a request for an idea's live socket; null if the path isn't one. */
    upgrade(request: Request, server: Server<LiveData>): Response | undefined | null {
      const match = PATH.exec(new URL(request.url).pathname)
      if (!match) {
        return null
      }
      const idea = decodeURIComponent(match[1]!)
      if (server.upgrade(request, { data: { kind: 'idea' as const, idea, user: null, timer: null, conn: null } })) {
        return undefined
      }
      return new Response('This is a WebSocket: connect with one.', { status: 426, headers: { upgrade: 'websocket' } })
    },
  }
}

/** A JWT's expiry, already verified; a personal token has none (it's checked again each time it's sent). */
export function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : Infinity
  } catch {
    return Infinity
  }
}
