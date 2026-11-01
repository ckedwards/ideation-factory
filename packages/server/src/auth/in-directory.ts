// Better Auth inside the directory actor (the spike's "approach 2"): its tables
// sit next to the directory's, created by its own migrations, and it reads and
// writes them through ActorSqliteDialect with real transactions. App nodes
// forward /api/auth/* to the actor as an action and check the JWTs it signs by
// signature alone, so the actor is only on the path to sign in or refresh, and
// for personal tokens (a stopgap for CI), which it checks on every request.
import { getMigrations } from 'better-auth/db/migration'
import type { Directory, User } from '../directory/types.ts'
import type { Sql } from '../sql/sql.ts'
import {
  type Auth,
  type AuthSettings,
  authOptions,
  CLI_CLIENT_ID,
  CLI_CODE_PATH,
  grantClaims,
  makeAuth,
  type Purpose,
} from './config.ts'
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
    grants: directory,
    users: {
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
    },
  })
}

/**
 * The cli's OAuth client, made when the directory wakes if it isn't there: a
 * public client (no secret) that must use PKCE, redirecting to a loopback port
 * (any port, RFC 8252) or to the page that shows the code to paste.
 */
export async function ensureCliClient(auth: Auth, settings: AuthSettings): Promise<void> {
  const context = await auth.$context
  const found = await context.adapter.findOne({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: CLI_CLIENT_ID }],
  })
  if (found) {
    return
  }
  const now = new Date()
  await context.adapter.create({
    model: 'oauthClient',
    data: {
      clientId: CLI_CLIENT_ID,
      name: 'ideaf, the command line',
      disabled: false,
      // the purpose and limits are chosen every time
      skipConsent: false,
      scopes: ['offline_access'],
      redirectUris: ['http://127.0.0.1/callback', `${settings.baseURL}${CLI_CODE_PATH}`],
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      requirePKCE: true,
      applicationType: 'native',
      createdAt: now,
      updatedAt: now,
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

/**
 * Who a token is for, and what its token grant allows (when it has one): what
 * the API's caller is made from. `ro` and `lim` are the grant's read only and
 * limited flags, so an app node can refuse a write without asking the directory.
 */
export type Claims = { sub: string; purpose: Purpose; bot?: string; gid?: string; ro?: boolean; lim?: boolean }

type VerifiedKey = {
  valid: boolean
  key: { id: string; referenceId: string; configId?: string; metadata: Record<string, unknown> | null } | null
}

/**
 * Who a personal (or site admin) token is for, checked in the directory on
 * every request: tokens are a stopgap for CI, where nobody can sign in, so
 * that's acceptable. People and agents use OAuth, whose 15-minute access
 * tokens are checked by signature alone. Null if the token isn't valid, its
 * owner is inactive, or the site's policy doesn't allow it.
 */
export async function verifyPersonalToken(
  auth: Auth,
  settings: AuthSettings,
  grants: Pick<Directory, 'tokenGrant'>,
  token: string,
): Promise<Claims | null> {
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
  const user = (await context.internalAdapter.findUserById(key.referenceId)) as {
    email: string
    inactive?: boolean
  } | null
  if (!user || user.inactive) {
    return null
  }
  const admin = key.configId === 'admin'
  if (!admin && !personalTokensAllowed(settings, user.email)) {
    return null
  }
  const meta = key.metadata ?? {}
  if (admin) {
    // the stand-in for an audit log: every use of a site admin token is recorded
    console.warn(`site admin token ${key.id} used by ${key.referenceId}: ${String(meta.reason ?? '')}`)
  }
  if (typeof meta.grant === 'string') {
    // made with a token grant: its purpose and limits, while it's in force
    const grant = await grants.tokenGrant(meta.grant)
    if (!grant || grant.user !== key.referenceId) {
      return null
    }
    return { sub: key.referenceId, ...grantClaims(grant) }
  }
  const purpose = (typeof meta.purpose === 'string' ? meta.purpose : 'me') as Purpose
  const bot = typeof meta.bot === 'string' && purpose !== 'me' ? meta.bot : undefined
  return { sub: key.referenceId, purpose, ...(bot ? { bot } : {}) }
}

/** Whether the site's personal-token policy lets this person make and use them. */
export function personalTokensAllowed(settings: AuthSettings, email: string): boolean {
  const policy = settings.personalTokens ?? 'admins'
  return policy === 'on' || (policy === 'admins' && settings.siteAdmins.has(email.toLowerCase()))
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
