// Sign-in on an app node. Better Auth runs in the directory actor, so this
// forwards /api/auth/* there. Every API request from a person or an agent
// carries a 15-minute JWT (from OAuth, or a browser session), checked here by
// signature alone: no directory call. A personal token (a stopgap for CI) is
// checked in the directory on every request instead.
import type { ApiErrorBody, Caller, Operation, TokenScope } from '@ideaf/api'
import { getIPFromHeader } from '@better-auth/core/utils/ip'
import { createLocalJWKSet, errors, type JSONWebKeySet, jwtVerify } from 'jose'
import { CLIENT_IP_HEADER } from './config.ts'
import type { Claims, WireRequest, WireResponse } from './in-directory.ts'

/** The directory actor's sign-in actions, as an app node calls them. */
export interface AuthDirectory {
  auth(request: WireRequest): Promise<WireResponse>
  verifyToken(token: string): Promise<Claims | null>
  user(id: string): Promise<{ inactive: boolean } | null>
}

/**
 * How long the public signing keys are used before they're fetched again (and
 * at once for a key not seen before): an emergency key rotation stops old
 * tokens within this long. They're fetched again in the background from
 * REFRESH_AFTER_MS, so requests don't wait for it.
 */
const KEYS_TTL_MS = 60_000
const REFRESH_AFTER_MS = 50_000
/**
 * How much longer the keys are still used while a refresh hasn't come back
 * (the directory is slow, or failing): a rotation then stops old tokens within
 * KEYS_TTL_MS + STALE_MAX_MS at most. Past it, requests wait for the keys, and
 * get unavailable if they can't be had.
 */
const STALE_MAX_MS = 30_000
/** After a refresh in the background fails, the next waits this long. */
const RETRY_MS = 1_000

/** The signing keys couldn't be fetched: tokens can't be checked for now, which isn't the token's fault. */
class KeysUnavailable extends Error {}
const PERSONAL_TOKEN = /^ideaf_/
/** What a token limited to some teams or ideas may still write: those ideas' content. */
const CONTENT_WRITES = new Set(['create_idea', 'sync', 'edit', 'add_comment', 'reply', 'resolve_comment'])

/**
 * Who a request came from. `peer` is whoever connected. If that's one of the
 * trusted proxies, X-Forwarded-For is walked from the right, past any other
 * trusted proxies, to the first address that isn't one: the client. Otherwise
 * the peer is the client, and X-Forwarded-For (anyone can send one) is
 * ignored. Null when there's no peer (a request made in process, in tests).
 */
export function clientAddress(
  peer: string | undefined,
  forwardedFor: string | null,
  trustedProxies: readonly string[] = [],
): string | null {
  if (!peer) {
    return null
  }
  if (trustedProxies.length === 0) {
    return getIPFromHeader(peer)
  }
  const chain = [forwardedFor, peer].filter(Boolean).join(', ')
  return getIPFromHeader(chain, { trustedProxies: [...trustedProxies] })
}

/**
 * A proxy nobody listed: with no trusted proxies set, a request from this
 * machine or a private network that carries X-Forwarded-For most likely came
 * through a reverse proxy or load balancer, so every client is counted as that
 * one address. What trusted_proxies should probably be, or null.
 */
export function unlistedProxy(
  peer: string | undefined,
  forwardedFor: string | null,
  trustedProxies: readonly string[],
): string | null {
  if (!peer || !forwardedFor || trustedProxies.length > 0) {
    return null
  }
  const address = peer.replace(/^::ffff:/i, '')
  if (address === '::1' || address.startsWith('127.')) {
    return '127.0.0.1,::1'
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) || /^f[cd][0-9a-f]{2}:/i.test(address)) {
    return address
  }
  return null
}

export function authGateway(directory: AuthDirectory, baseURL: string, trustedProxies: readonly string[] = []) {
  let warned = false
  /** A request forwarded to Better Auth in the directory actor, with the address it came from (`peer`). */
  const forward = async (request: Request, peer?: string): Promise<Response> => {
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
    const forwardedFor = request.headers.get('x-forwarded-for')
    const proxy = warned ? null : unlistedProxy(peer, forwardedFor, trustedProxies)
    if (proxy) {
      warned = true
      console.warn(
        `requests from ${peer} carry X-Forwarded-For, but trusted_proxies isn't set, so sign-in's rate limits count every client behind it as one. If it's your proxy, set IDEAF__TRUSTED_PROXIES=${proxy}.`,
      )
    }
    const client = clientAddress(peer, forwardedFor, trustedProxies)
    const sent: Array<[string, string]> = [...request.headers].filter(([name]) => name !== CLIENT_IP_HEADER)
    if (client) {
      sent.push([CLIENT_IP_HEADER, client])
    }
    const wire = await directory.auth({
      url: request.url,
      method: request.method,
      headers: sent,
      ...(body && body.byteLength > 0 ? { body: Buffer.from(body).toString('base64') } : {}),
    })
    const headers = new Headers()
    for (const [name, value] of wire.headers) {
      headers.append(name, value)
    }
    const empty = wire.status === 204 || wire.status === 304
    return new Response(empty ? null : Buffer.from(wire.body, 'base64'), { status: wire.status, headers })
  }

  let keys: { at: number; set: ReturnType<typeof createLocalJWKSet> } | null = null
  // one fetch at a time: requests that find the keys stale wait for it, rather than each fetching them through
  // the directory at once (under load that was hundreds at once, and their failures became 401s)
  let fetching: Promise<ReturnType<typeof createLocalJWKSet>> | null = null
  const fetchKeys = () => {
    fetching ??= (async () => {
      try {
        // from this node itself: without an address, Better Auth's rate limiter would warn that it can't tell clients apart
        const response = await forward(new Request(`${baseURL}/api/auth/jwks`), '127.0.0.1')
        if (!response.ok) {
          throw new KeysUnavailable(`fetching the signing keys answered ${response.status}`)
        }
        const set = createLocalJWKSet((await response.json()) as JSONWebKeySet)
        keys = { at: Date.now(), set }
        return set
      } catch (error) {
        throw error instanceof KeysUnavailable
          ? error
          : new KeysUnavailable(`fetching the signing keys failed: ${error}`)
      } finally {
        fetching = null
      }
    })()
    return fetching
  }
  let failedAt = 0
  const signingKeys = async (fresh = false) => {
    const age = keys ? Date.now() - keys.at : Infinity
    // none yet, too old even to stand in, or a key this node hasn't seen: wait for them
    if (!keys || fresh || age > KEYS_TTL_MS + STALE_MAX_MS) {
      return fetchKeys()
    }
    // due soon, or overdue while a refresh hasn't come back: fetched in the background, these meanwhile
    if (age > REFRESH_AFTER_MS && !fetching && Date.now() - failedAt > RETRY_MS) {
      fetchKeys().catch((error: unknown) => {
        failedAt = Date.now()
        console.warn(
          `refreshing the token signing keys failed; using the ones from ${Math.round(age / 1000)} s ago`,
          error,
        )
      })
    }
    return keys.set
  }

  /** A JWT's claims, if we signed it for `audience`: the API (the deployment's URL), or the MCP server. */
  const verify = async (token: string, audience: string): Promise<Claims | null> => {
    const options = { issuer: baseURL, audience, algorithms: ['EdDSA'] }
    try {
      return toClaims((await jwtVerify(token, await signingKeys(), options)).payload)
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey) {
        // signed with a key this node hasn't seen yet: the keys rotated
        try {
          return toClaims((await jwtVerify(token, await signingKeys(true), options)).payload)
        } catch (again) {
          if (again instanceof KeysUnavailable) {
            throw again
          }
          return null
        }
      }
      if (error instanceof KeysUnavailable) {
        throw error
      }
      return null
    }
  }

  return {
    forward,

    /**
     * Who's calling, and what their token's grant allows. For a write, also
     * that the token may write it and the account is still active.
     */
    async authenticate(
      request: Request,
      operation: Operation,
      /** Whom its JWT must be for: the API unless said (the MCP server's tool calls say theirs). */
      audience = baseURL,
    ): Promise<{ caller: Caller; token: TokenScope | null } | ApiErrorBody | null> {
      const header = request.headers.get('authorization') ?? ''
      const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
      if (!token) {
        return null
      }
      let claims: Claims | null
      try {
        claims = PERSONAL_TOKEN.test(token) ? await directory.verifyToken(token) : await verify(token, audience)
      } catch (error) {
        if (error instanceof KeysUnavailable) {
          return { code: 'unavailable', message: "tokens can't be checked right now; try again shortly" }
        }
        throw error
      }
      if (!claims) {
        return null
      }
      const scope = claims.gid ? { id: claims.gid, readOnly: Boolean(claims.ro), limited: Boolean(claims.lim) } : null
      // a token can always revoke itself, whatever else it may not do
      if (operation.kind === 'write' && operation.name !== 'revoke_token') {
        if (scope?.readOnly) {
          return { code: 'forbidden', message: 'this token is read only' }
        }
        if (scope?.limited && !CONTENT_WRITES.has(operation.name)) {
          return {
            code: 'forbidden',
            message: 'this token is limited to some teams or ideas, so it can’t share, move ideas or manage teams',
          }
        }
        // reads ride out a token's last minutes; writes check status every time
        const user = await directory.user(claims.sub)
        if (!user || user.inactive) {
          return { code: 'forbidden', message: 'this account is inactive' }
        }
      }
      return { caller: { user: claims.sub, bot: claims.bot ?? null, purpose: claims.purpose }, token: scope }
    },
  }
}

function toClaims(payload: Record<string, unknown>): Claims | null {
  if (typeof payload.sub !== 'string') {
    return null
  }
  const purpose = payload.purpose === 'bot-for-me' || payload.purpose === 'bot' ? payload.purpose : 'me'
  const bot = typeof payload.bot === 'string' && purpose !== 'me' ? payload.bot : undefined
  return {
    sub: payload.sub,
    purpose,
    ...(bot ? { bot } : {}),
    ...(typeof payload.gid === 'string'
      ? { gid: payload.gid, ro: payload.ro === true, lim: payload.lim === true }
      : {}),
  }
}
