// Better Auth inside the directory actor (the spike's "approach 2"): its tables
// sit next to the directory's, created by its own migrations, and it reads and
// writes them through ActorSqliteDialect with real transactions. App nodes
// forward /api/auth/* to the actor as an action and check the JWTs it signs by
// signature alone, so the actor is only on the path to sign in, refresh, or
// exchange a personal token.
import { getMigrations } from 'better-auth/db/migration'
import type { Directory, User } from '../directory/types.ts'
import type { Sql } from '../sql/sql.ts'
import { ACCESS_TOKEN_SECONDS, type Auth, type AuthSettings, authOptions, makeAuth, type Purpose } from './config.ts'
import { ActorSqliteDialect } from './dialect.ts'

const database = (sql: Sql, transaction = false) =>
  ({ dialect: new ActorSqliteDialect(sql), type: 'sqlite', transaction }) as never

/** Better Auth's tables: created or extended to match the configuration. Runs in onMigrate, after the directory's own. */
export async function migrateAuth(sql: Sql, settings: AuthSettings): Promise<void> {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions(database(sql), settings))
  if (toBeCreated.length > 0 || toBeAdded.length > 0) {
    await runMigrations()
  }
}

/** Better Auth for this wake-up of the actor, keeping the directory's people in step with its accounts. */
export function authInDirectory(sql: Sql, settings: AuthSettings, directory: Directory): Auth {
  return makeAuth(database(sql, true), settings, {
    // after the sign-up's transaction commits (Better Auth queues these), so
    // the directory's own statements don't wait on it
    created: async (user) => {
      await directory.ensureUser({
        id: user.id,
        handle: user.username!,
        name: user.name || user.username!,
        email: user.email,
      })
    },
    updated: async (user) => {
      await directory.updateUser(user.id, {
        ...(user.name ? { name: user.name } : {}),
        ...(user.inactive !== undefined && user.inactive !== null ? { inactive: Boolean(user.inactive) } : {}),
      })
    },
  })
}

/** A request carried as an action argument; the body base64 encoded. */
export type WireRequest = { url: string; method: string; headers: Array<[string, string]>; body?: string }
export type WireResponse = { status: number; headers: Array<[string, string]>; body: string }

export async function handleAuthRequest(auth: Auth, wire: WireRequest): Promise<WireResponse> {
  const request = new Request(wire.url, {
    method: wire.method,
    headers: wire.headers,
    ...(wire.body !== undefined ? { body: Buffer.from(wire.body, 'base64') } : {}),
  })
  const response = await auth.handler(request)
  const headers: Array<[string, string]> = []
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') {
      headers.push([name, value])
    }
  })
  for (const cookie of response.headers.getSetCookie()) {
    headers.push(['set-cookie', cookie])
  }
  return { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()).toString('base64') }
}

/** Who a short-lived token is for: what the API's caller is made from. */
export type Claims = { sub: string; purpose: Purpose; bot?: string }

export type Exchanged = { token: string; expiresIn: number; claims: Claims }

type VerifiedKey = {
  valid: boolean
  key: { id: string; referenceId: string; configId?: string; metadata: Record<string, unknown> | null } | null
}

/**
 * A personal (or site admin) token exchanged for a 15-minute JWT: the
 * long-lived token is checked here, once, and the JWT is checked by signature
 * alone until it expires. Null if the token isn't valid or its owner is inactive.
 */
export async function exchangeToken(auth: Auth, settings: AuthSettings, token: string): Promise<Exchanged | null> {
  let key: VerifiedKey['key'] = null
  for (const configId of ['personal', 'admin']) {
    const verified = (await auth.api
      .verifyApiKey({ body: { key: token, configId } } as never)
      .catch(() => null)) as VerifiedKey | null
    if (verified?.valid && verified.key) {
      key = verified.key
      break
    }
  }
  if (!key) {
    return null
  }
  const context = await auth.$context
  const user = (await context.internalAdapter.findUserById(key.referenceId)) as { inactive?: boolean } | null
  if (!user || user.inactive) {
    return null
  }
  const meta = key.metadata ?? {}
  const purpose = (typeof meta.purpose === 'string' ? meta.purpose : 'me') as Purpose
  const bot = typeof meta.bot === 'string' && purpose !== 'me' ? meta.bot : undefined
  const admin = key.configId === 'admin'
  if (admin) {
    // the stand-in for an audit log: every use of a site admin token is recorded
    console.warn(`site admin token ${key.id} used by ${key.referenceId}: ${String(meta.reason ?? '')}`)
  }
  const claims: Claims = { sub: key.referenceId, purpose, ...(bot ? { bot } : {}) }
  const now = Math.floor(Date.now() / 1000)
  const { token: signed } = await auth.api.signJWT({
    body: {
      payload: {
        ...claims,
        tid: key.id,
        ...(admin ? { site_admin: true } : {}),
        iss: settings.baseURL,
        aud: settings.baseURL,
        iat: now,
        exp: now + ACCESS_TOKEN_SECONDS,
      },
    },
  })
  return { token: signed, expiresIn: ACCESS_TOKEN_SECONDS, claims }
}

/**
 * Marks a person inactive (or active again). Inactive, their sessions end at
 * once and no new short-lived token is issued; ones already issued run out
 * within 15 minutes, and writes check status every time.
 */
export async function setInactive(auth: Auth, id: string, inactive: boolean): Promise<User | null> {
  const context = await auth.$context
  const updated = await context.internalAdapter.updateUser(id, { inactive })
  if (!updated) {
    return null
  }
  if (inactive) {
    await context.internalAdapter.deleteUserSessions(id)
  }
  const u = updated as { id: string; username?: string; name: string; inactive?: boolean }
  return { id: u.id, handle: u.username ?? '', name: u.name, inactive: Boolean(u.inactive) }
}
