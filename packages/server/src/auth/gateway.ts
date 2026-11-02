// Sign-in on an app node. Better Auth runs in the directory actor, so this
// forwards /api/auth/* there. Every API request from a person or an agent
// carries a 15-minute JWT (from OAuth, or a browser session), checked here by
// signature alone: no directory call. A personal token (a stopgap for CI) is
// checked in the directory on every request instead.
import type { ApiErrorBody, Caller, Operation, TokenScope } from '@ideaf/api'
import { createLocalJWKSet, errors, type JSONWebKeySet, jwtVerify } from 'jose'
import type { Claims, WireRequest, WireResponse } from './in-directory.ts'

/** The directory actor's sign-in actions, as an app node calls them. */
export interface AuthDirectory {
  auth(request: WireRequest): Promise<WireResponse>
  verifyToken(token: string): Promise<Claims | null>
  user(id: string): Promise<{ inactive: boolean } | null>
}

/**
 * Public signing keys are fetched again this often (and at once for a key not
 * seen before): an emergency key rotation stops old tokens within this long.
 */
const KEYS_TTL_MS = 60_000
const PERSONAL_TOKEN = /^ideaf_/
/** What a token limited to some teams or ideas may still write: those ideas' content. */
const CONTENT_WRITES = new Set(['create_idea', 'sync', 'edit', 'add_comment', 'reply', 'resolve_comment'])

export function authGateway(directory: AuthDirectory, baseURL: string) {
  /** A request forwarded to Better Auth in the directory actor. */
  const forward = async (request: Request): Promise<Response> => {
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
    const wire = await directory.auth({
      url: request.url,
      method: request.method,
      headers: [...request.headers],
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
  const signingKeys = async (fresh = false) => {
    if (!keys || fresh || Date.now() - keys.at > KEYS_TTL_MS) {
      const response = await forward(new Request(`${baseURL}/api/auth/jwks`))
      keys = { at: Date.now(), set: createLocalJWKSet((await response.json()) as JSONWebKeySet) }
    }
    return keys.set
  }

  const verify = async (token: string): Promise<Claims | null> => {
    const options = { issuer: baseURL, audience: baseURL, algorithms: ['EdDSA'] }
    try {
      return toClaims((await jwtVerify(token, await signingKeys(), options)).payload)
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey) {
        // signed with a key this node hasn't seen yet: the keys rotated
        try {
          return toClaims((await jwtVerify(token, await signingKeys(true), options)).payload)
        } catch {
          return null
        }
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
    ): Promise<{ caller: Caller; token: TokenScope | null } | ApiErrorBody | null> {
      const header = request.headers.get('authorization') ?? ''
      const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
      if (!token) {
        return null
      }
      const claims = PERSONAL_TOKEN.test(token) ? await directory.verifyToken(token) : await verify(token)
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
