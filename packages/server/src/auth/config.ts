// Better Auth's configuration: sign-in with an email code or a passkey (never a
// password), handles, 15-minute JWTs, and personal and site admin tokens. Our
// account rules are configuration plus the hooks and the small plugin below;
// nothing in the library is patched. It runs inside the directory actor (see
// actors/directory.ts), on its own tables there. It's also the OAuth
// authorization server: the cli signs in with the authorization code flow, and
// each token's purpose and limits come from the token grant chosen on the
// consent page. A deployment can hand sign-in to its identity provider (single
// sign-on, OIDC or SAML) and let it manage people with SCIM. MCP clients sign
// in the same way, identified by their Client ID Metadata Documents (CIMD),
// for tokens whose audience is the hosted MCP server.
//
// Worked out in the Better Auth spike: docs/mvp/spike-better-auth.md.
import { timingSafeEqual } from 'node:crypto'
import { apiKey } from '@better-auth/api-key'
import { defineRequestState, queueAfterTransactionHook } from '@better-auth/core/context'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { mcp } from '@better-auth/mcp'
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { scim } from '@better-auth/scim'
import { sso } from '@better-auth/sso'
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth, getCurrentAdapter } from 'better-auth'
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from 'better-auth/api'
import { emailOTP, jwt, username } from 'better-auth/plugins'
import * as z from 'zod'
import type { Directory, TokenGrant } from '../directory/types.ts'

/** How a short-lived access token lasts. */
export const ACCESS_TOKEN_SECONDS = 15 * 60
/**
 * The key access tokens are signed with is replaced this often (Better Auth
 * mints the next one when it's needed), and a replaced key stays published
 * this long, well past the tokens it signed, so they keep verifying.
 */
export const SIGNING_KEY_ROTATION_SECONDS = 30 * 24 * 3600
export const SIGNING_KEY_GRACE_SECONDS = 24 * 3600
const YEAR_SECONDS = 365 * 24 * 3600
const ADMIN_TOKEN_SECONDS = 30 * 24 * 3600
/** A passkey can only be added this soon after signing in with an email code. */
const PASSKEY_WINDOW_MS = 5 * 60 * 1000

/** Sends sign-in codes: to the server log in development, a capture in tests, real email in production. */
export interface Mailer {
  sendCode(email: string, code: string, kind: string): Promise<void>
}

export interface AuthSettings {
  /** The deployment's public URL: the JWTs' issuer and audience, and the passkey origin. */
  baseURL: string
  /** Signs cookies and encrypts the signing keys at rest. */
  secret: string
  /** Emails of the site admins: only they get site admin tokens. */
  siteAdmins: ReadonlySet<string>
  mailer: Mailer
  /**
   * Who may make and use personal tokens, a stopgap for CI where nobody can
   * sign in (people and agents use OAuth): everyone, site admins only (the
   * default), or no one. Turning them off refuses existing ones too. Site admin
   * tokens aren't affected.
   */
  personalTokens?: PersonalTokenPolicy
  /** Rate limits on sign-in (on unless false: tests sign up many people from one address). */
  rateLimit?: boolean
  /**
   * The reverse proxies (load balancers) in front of the app nodes, as IPs or
   * CIDR ranges. Only a request that came through one has its client's address
   * taken from X-Forwarded-For; otherwise the address is whoever connected.
   * Sign-in's rate limits count per client address.
   */
  trustedProxies?: readonly string[]
  /**
   * Single sign-on: the organization's identity provider signs everyone in,
   * instead of email codes and passkeys (site admins keep an email code, the
   * way in when the provider is down). Read on every request, so a site admin
   * page can change it later without a restart.
   */
  sso?: SsoSettings | null
  /**
   * The bearer token the identity provider's SCIM client uses (at least 32
   * characters): it creates people ahead of their first sign-in, keeps names
   * and emails in step, and deactivates people removed there. Off without one.
   */
  scimToken?: string | null
  /** MCP clients: which may sign in, and (for tests) how their metadata documents are fetched. */
  mcp?: McpSettings
}

/** The hosted MCP server's sign-in. */
export interface McpSettings {
  /**
   * Only clients whose metadata document (their client ID, a URL) is on one
   * of these hosts may sign in, like `claude.ai` or `vscode.dev`; any client
   * with a valid document when unset.
   */
  clientHosts?: readonly string[] | null
  /**
   * Fetches a client's metadata document. Production always uses Better
   * Auth's transport: public addresses only, the address pinned, no
   * redirects. Tests serve documents without a network.
   */
  fetchClientMetadata?: ClientMetadataResourceFetch
}

/** Whether an MCP client's metadata document is on one of these hosts (mcp.client_hosts). */
export const clientHostAllowed = (hosts: readonly string[]) => (url: string) => {
  try {
    return hosts.includes(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Where the hosted MCP server is, under the deployment's URL: its tokens' audience. */
export const MCP_PATH = '/mcp'

/** The deployment's one identity provider: OIDC or SAML 2.0. */
export interface SsoSettings {
  /** Shown on the sign-in page: "Continue with <name>". */
  name: string
  /** Only emails in these domains sign in, or get an account. */
  domains: readonly string[]
  /** Make an account for someone new the provider signs in; off, a site admin adds people first (or SCIM does). */
  autoCreate: boolean
  oidc?: {
    /** The provider's issuer URL; its discovery document is at <issuer>/.well-known/openid-configuration. */
    issuer: string
    clientId: string
    clientSecret: string
  }
  saml?: {
    /** The provider's metadata XML: its entity ID, sign-in URL and signing certificate. */
    metadata: string
    /** Our private key and certificate (PEM), for providers that want signed requests. */
    spPrivateKey?: string
    spCertificate?: string
  }
}

/**
 * The client's address, as the app node worked it out (see clientAddress in
 * gateway.ts), on requests it forwards to Better Auth: the one place Better
 * Auth takes it from. A client's own copy of the header is dropped.
 */
export const CLIENT_IP_HEADER = 'x-ideaf-client-ip'

/** The configured provider's ID in Better Auth: there's only ever one. */
export const SSO_PROVIDER_ID = 'ideaf-sso'

export const PERSONAL_TOKEN_POLICIES = ['on', 'admins', 'off'] as const
export type PersonalTokenPolicy = (typeof PERSONAL_TOKEN_POLICIES)[number]

/** What the directory does when Better Auth adds or changes a person. */
export interface UserHooks {
  created(user: AuthUser): Promise<void>
  /**
   * `confirmed`: a suggested handle (single sign-on's) was kept or replaced on
   * the first visit, so it was never really anyone's to keep leading to them.
   */
  updated(user: AuthUser, how?: { confirmed: boolean }): Promise<void>
}

/** The directory, as Better Auth reaches it from inside the actor. */
export interface AuthDeps {
  users: UserHooks
  grants: Pick<Directory, 'createTokenGrant' | 'tokenGrant' | 'revokeTokenGrant'>
  /** Until when a handle someone left stays theirs (the directory's handle aliases); null if it's free to `requester`. */
  parkedUntil?: (handle: string, requester: string | null) => Promise<number | null>
}

/** The cli's OAuth client: public (no secret), PKCE, a loopback redirect or the paste-a-code page. */
export const CLI_CLIENT_ID = 'ideaf-cli'
/** Where the authorization code goes when the cli can't listen on localhost: a page that shows it. */
export const CLI_CODE_PATH = '/cli/code'

/**
 * A token grant's claims in an access token: who it's for (`purpose`, `bot`),
 * the grant (`gid`), and the two things an app node checks without asking the
 * directory: read only (`ro`) and limited to some teams or ideas (`lim`).
 */
export function grantClaims(grant: TokenGrant) {
  return {
    purpose: grant.purpose,
    ...(grant.bot ? { bot: grant.bot } : {}),
    gid: grant.id,
    ro: grant.readOnly,
    lim: grant.limits !== null,
  }
}

const TokenGrantBody = z.object({
  purpose: z.enum(['me', 'bot-for-me', 'bot']),
  bot: z.string().optional(),
  readOnly: z.boolean().optional(),
  limits: z
    .object({
      teams: z.array(z.string()).max(50).optional(),
      ideas: z.array(z.string()).max(50).optional(),
      noTeam: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  /** Use it for the OAuth consent this session is about to give. */
  forConsent: z.boolean().optional(),
})

export type AuthUser = {
  id: string
  email: string
  name: string
  username?: string | null
  inactive?: boolean | null
  /** False for an account single sign-on or SCIM made, until its person keeps or changes the suggested handle. */
  handleConfirmed?: boolean | null
}

/** A token's purpose: how activity with it is labeled. */
export const PURPOSES = ['me', 'bot-for-me', 'bot'] as const
export type Purpose = (typeof PURPOSES)[number]
export const BOT_NAME = /^[a-z0-9][a-z0-9-]{0,38}$/

// Handles: the directory's rule (lowercase letters, digits and dashes, not at
// either end), at least 2 characters, and not a word the app uses.
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])$/
const RESERVED = new Set([
  'admin',
  'api',
  'auth',
  'help',
  'ideaf',
  'login',
  'logout',
  'mcp',
  'me',
  'new',
  'root',
  'settings',
  'support',
  'system',
])
export function validHandle(handle: string): boolean {
  return HANDLE.test(handle) && !RESERVED.has(handle)
}

type Adapter = {
  findOne(args: { model: string; where: Array<{ field: string; value: unknown }> }): Promise<unknown>
  update(args: {
    model: string
    where: Array<{ field: string; value: unknown }>
    update: Record<string, unknown>
  }): Promise<unknown>
  deleteMany(args: { model: string; where: Array<{ field: string; value: unknown }> }): Promise<unknown>
}
type UserRow = AuthUser & { id: string }

/**
 * A free handle for an account single sign-on or SCIM makes, from the email:
 * "Jane.Doe+x@acme.test" becomes "jane-doe-x", or "jane-doe-x-2" if that's
 * taken. Its person can keep or change it on their first visit.
 */
export async function suggestHandle(
  email: string,
  adapter: Adapter,
  parked: (handle: string) => Promise<boolean> = async () => false,
): Promise<string> {
  let base = email
    .slice(0, email.lastIndexOf('@'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34)
    .replace(/-+$/, '')
  if (!validHandle(base)) {
    base = `user-${base}`.replace(/-+$/, '')
  }
  for (let n = 1; ; n++) {
    const handle = n === 1 ? base : `${base}-${n}`
    if (
      !(await adapter.findOne({ model: 'user', where: [{ field: 'username', value: handle }] })) &&
      !(await parked(handle))
    ) {
      return handle
    }
  }
}

/**
 * A sign-in code this request couldn't send. Better Auth logs a failed send and
 * answers "sent" anyway; an after-hook (in rules) turns this into an error, so
 * the person knows to try again.
 */
const unsentCode = defineRequestState<{ failed: boolean }>(() => ({ failed: false }))

const emailDomain = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase()
const isSiteAdmin = (settings: AuthSettings, email: string) => settings.siteAdmins.has(email.toLowerCase())

/**
 * Tells the directory about a change made straight in Better Auth's tables
 * (which skips its hooks), once the transaction commits: the user as it is
 * now, read inside the transaction.
 */
async function syncAfterCommit(adapter: Adapter, hooks: UserHooks | undefined, userId: string): Promise<void> {
  if (!hooks) {
    return
  }
  const user = (await adapter.findOne({ model: 'user', where: [{ field: 'id', value: userId }] })) as UserRow | null
  if (user) {
    await queueAfterTransactionHook(() => hooks.updated(user))
  }
}

/**
 * Which account a person the identity provider vouched for is. Runs inside
 * the sign-in's transaction.
 * 1. Their provider identity was seen before: that account. If the provider
 *    changed their email, the primary email follows (under single sign-on the
 *    provider owns it), unless another account has it.
 * 2. Otherwise the account with their email, so switching a deployment to
 *    single sign-on keeps everyone's ideas, comments and tokens.
 * 3. Otherwise a new account, if the deployment makes them automatically.
 * Emails outside the allowed domains, and inactive accounts, are refused.
 */
function resolveSsoUser(settings: AuthSettings, hooks: UserHooks | undefined) {
  return async (
    input: { providerId: string; accountKey: { accountId: string }; providerUser: { email: string } },
    { database }: { database: unknown },
  ) => {
    const db = database as Adapter
    const config = settings.sso
    const email = input.providerUser.email.toLowerCase()
    const reject = (code: string, message: string) => ({ action: 'reject' as const, code, message })
    if (!config) {
      return reject('sso_off', 'this site doesn’t sign in with single sign-on')
    }
    if (!config.domains.includes(emailDomain(email))) {
      return reject('domain_not_allowed', `${emailDomain(email)} emails can’t sign in here`)
    }
    const account = (await db.findOne({
      model: 'account',
      where: [
        { field: 'providerId', value: input.providerId },
        { field: 'accountId', value: input.accountKey.accountId },
      ],
    })) as { userId: string } | null
    const byEmail = (await db.findOne({ model: 'user', where: [{ field: 'email', value: email }] })) as UserRow | null
    if (account) {
      const user = (await db.findOne({
        model: 'user',
        where: [{ field: 'id', value: account.userId }],
      })) as UserRow | null
      if (!user) {
        return reject('no_account', 'no account for this sign-in')
      }
      if (user.inactive) {
        return reject('inactive', 'this account is inactive')
      }
      if (byEmail && byEmail.id !== user.id) {
        return reject('email_taken', 'another account has this email')
      }
      if (user.email !== email) {
        await db.update({
          model: 'user',
          where: [{ field: 'id', value: user.id }],
          update: { email, updatedAt: new Date() },
        })
        await syncAfterCommit(db, hooks, user.id)
      }
      return { action: 'link' as const, userId: user.id, profile: 'preserve' as const }
    }
    if (byEmail) {
      if (byEmail.inactive) {
        return reject('inactive', 'this account is inactive')
      }
      return { action: 'link' as const, userId: byEmail.id, profile: 'preserve' as const }
    }
    if (!config.autoCreate) {
      return reject('no_account', 'you don’t have an account here yet: ask a site admin to add you')
    }
    return { action: 'continue' as const }
  }
}

/** The configured identity provider, as Better Auth's sso plugin takes it (none while single sign-on is off). */
function ssoProviders(settings: AuthSettings) {
  const config = settings.sso
  if (!config) {
    return []
  }
  const domain = config.domains[0]!
  if (config.oidc) {
    const { issuer, clientId, clientSecret } = config.oidc
    return [
      {
        providerId: SSO_PROVIDER_ID,
        domain,
        oidcConfig: {
          issuer,
          discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
          clientId,
          clientSecret,
          pkce: true,
          scopes: ['openid', 'email', 'profile'],
        },
      },
    ]
  }
  if (config.saml) {
    const { metadata, spPrivateKey, spCertificate } = config.saml
    return [
      {
        providerId: SSO_PROVIDER_ID,
        domain,
        samlConfig: {
          // our entity ID, as the provider knows us
          issuer: samlEntityId(settings),
          entryPoint: samlSignInUrl(metadata),
          callbackUrl: `${settings.baseURL}/api/auth/sso/saml2/sp/acs/${SSO_PROVIDER_ID}`,
          idpMetadata: { metadata },
          spMetadata: {},
          wantAssertionsSigned: true,
          ...(spPrivateKey ? { authnRequestsSigned: true, privateKey: spPrivateKey, cert: spCertificate } : {}),
          identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
          mapping: { email: 'email', name: 'name', firstName: 'firstName', lastName: 'lastName' },
        },
      },
    ]
  }
  return []
}

/** Our SAML entity ID: the metadata URL the provider is given. */
export const samlEntityId = (settings: Pick<AuthSettings, 'baseURL'>) =>
  `${settings.baseURL}/api/auth/sso/saml2/sp/metadata?providerId=${SSO_PROVIDER_ID}`

/** Where a SAML provider takes sign-in requests, from its metadata (the redirect binding, else any). */
function samlSignInUrl(metadata: string): string {
  const services = [...metadata.matchAll(/<(?:\w+:)?SingleSignOnService\b[^>]*>/g)].map((m) => m[0])
  const pick = services.find((s) => s.includes('HTTP-Redirect')) ?? services[0]
  const location = pick?.match(/Location="([^"]+)"/)?.[1]
  if (!location) {
    throw new Error('the SAML metadata has no SingleSignOnService location')
  }
  return location
}

/** Origins Better Auth may talk to: ours, and the identity provider's (often on a private network). */
function trustedOrigins(settings: AuthSettings): string[] {
  const origins = [settings.baseURL]
  const config = settings.sso
  try {
    if (config?.oidc) {
      origins.push(new URL(config.oidc.issuer).origin)
    }
    if (config?.saml) {
      origins.push(new URL(samlSignInUrl(config.saml.metadata)).origin)
    }
  } catch {
    // a bad provider URL fails at sign-in, with its own error
  }
  return origins
}

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Our account rules on Better Auth's endpoints, and our own endpoints, as a plugin. */
const rules = (settings: AuthSettings, deps?: AuthDeps): BetterAuthPlugin => ({
  id: 'ideaf-rules',
  ...(deps
    ? {
        endpoints: {
          // What a token may do, chosen on the consent page (or when making a
          // personal token): recorded as a token grant. For a consent, the
          // session remembers it until the consent is given, and Better Auth
          // keeps it as the consent's reference (see oauthProvider below).
          tokenGrant: createAuthEndpoint(
            '/ideaf/token-grant',
            { method: 'POST', use: [sessionMiddleware], body: TokenGrantBody },
            async (ctx) => {
              const { forConsent, ...input } = ctx.body
              const made = await deps.grants.createTokenGrant(ctx.context.session.user.id, {
                purpose: input.purpose,
                ...(input.bot ? { bot: input.bot } : {}),
                ...(input.readOnly ? { readOnly: true } : {}),
                ...(input.limits
                  ? {
                      limits: {
                        ...(input.limits.teams ? { teams: input.limits.teams } : {}),
                        ...(input.limits.ideas ? { ideas: input.limits.ideas } : {}),
                        ...(input.limits.noTeam ? { noTeam: true } : {}),
                      },
                    }
                  : {}),
              })
              if (!made.ok) {
                throw new APIError(made.error.code === 'not_found' ? 'NOT_FOUND' : 'BAD_REQUEST', {
                  message: made.error.message,
                })
              }
              if (forConsent) {
                await ctx.context.internalAdapter.updateSession(ctx.context.session.session.token, {
                  oauthGrant: made.value.id,
                })
              }
              return ctx.json({ grant: made.value })
            },
          ),
          // An account single sign-on or SCIM made has a handle suggested from
          // the email: on their first visit its person keeps or changes it.
          // The suggestion was never really theirs, so no alias keeps it
          // leading to them; later changes do keep the old one.
          confirmHandle: createAuthEndpoint(
            '/ideaf/confirm-handle',
            { method: 'POST', use: [sessionMiddleware], body: z.object({ handle: z.string() }) },
            async (ctx) => {
              const user = ctx.context.session.user as UserRow
              if (user.handleConfirmed !== false) {
                throw new APIError('BAD_REQUEST', { message: 'your handle is already set' })
              }
              const handle = ctx.body.handle.trim()
              if (!validHandle(handle)) {
                throw new APIError('BAD_REQUEST', {
                  message: 'a handle is 2 to 39 lowercase letters, digits and dashes, not at either end',
                })
              }
              const taken = await ctx.context.adapter.findOne({
                model: 'user',
                where: [{ field: 'username', value: handle }],
              })
              if (taken && handle !== user.username) {
                throw new APIError('BAD_REQUEST', { message: `@${handle} is taken: pick another handle` })
              }
              await ctx.context.internalAdapter.updateUser(user.id, {
                username: handle,
                displayUsername: handle,
                handleConfirmed: true,
              })
              return ctx.json({ handle })
            },
          ),
        },
      }
    : {}),
  hooks: {
    after: [
      {
        // the code was made but couldn't be sent: say so, rather than "sent"
        matcher: (ctx) => ctx.path === '/email-otp/send-verification-otp',
        handler: createAuthMiddleware(async () => {
          if ((await unsentCode.get()).failed) {
            throw new APIError('SERVICE_UNAVAILABLE', { message: 'the code couldn’t be sent: try again in a minute' })
          }
        }),
      },
      {
        // a consent uses the session's token grant once: the next one must choose again
        matcher: (ctx) => ctx.path === '/oauth2/consent',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx)
          if (session && (session.session as { oauthGrant?: string | null }).oauthGrant) {
            await ctx.context.internalAdapter.updateSession(session.session.token, { oauthGrant: null })
          }
        }),
      },
    ],
    before: [
      {
        // Removing an app (its consent, from Settings) signs it out: Better Auth
        // only deletes the consent row, and each refresh token keeps its own
        // grant, so every grant behind the app's refresh tokens for this person
        // is revoked (a refresh then gets nothing), and the tokens with them
        matcher: (ctx) => Boolean(deps) && ctx.path === '/oauth2/delete-consent',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx)
          const id = (ctx.body as { id?: unknown } | undefined)?.id
          if (!session || typeof id !== 'string') {
            return
          }
          const adapter = ctx.context.adapter
          const consent = (await adapter.findOne({ model: 'oauthConsent', where: [{ field: 'id', value: id }] })) as {
            userId: string | null
            clientId: string
            referenceId: string | null
          } | null
          if (!consent || consent.userId !== session.user.id) {
            return
          }
          const tokens = (await adapter.findMany({
            model: 'oauthRefreshToken',
            where: [
              { field: 'userId', value: session.user.id },
              { field: 'clientId', value: consent.clientId },
            ],
          })) as Array<{ referenceId: string | null }>
          const grants = new Set([consent.referenceId, ...tokens.map((t) => t.referenceId)].filter(Boolean) as string[])
          for (const grant of grants) {
            await deps!.grants.revokeTokenGrant(session.user.id, grant)
          }
          await adapter.updateMany({
            model: 'oauthRefreshToken',
            where: [
              { field: 'userId', value: session.user.id },
              { field: 'clientId', value: consent.clientId },
            ],
            update: { revoked: new Date() },
          })
        }),
      },
      {
        // A handle someone left is kept for them for a while (HANDLE_PARKED_MS):
        // nobody else can sign up with it, rename to it or be told it's free
        matcher: (ctx) =>
          Boolean(deps?.parkedUntil) &&
          ['/sign-in/email-otp', '/update-user', '/is-username-available', '/ideaf/confirm-handle'].includes(
            ctx.path ?? '',
          ),
        handler: createAuthMiddleware(async (ctx) => {
          const body = (ctx.body ?? {}) as { username?: unknown; handle?: unknown }
          const handle = String(body.username ?? body.handle ?? '')
            .trim()
            .toLowerCase()
          if (!handle) {
            return
          }
          const session = await getSessionFromCtx(ctx).catch(() => null)
          const until = await deps!.parkedUntil!(handle, session?.user.id ?? null)
          if (until) {
            throw new APIError('BAD_REQUEST', {
              code: 'HANDLE_PARKED',
              message: `@${handle} was someone else's until recently, so it's kept for them until ${new Date(until).toISOString().slice(0, 10)}: pick another handle`,
            })
          }
        }),
      },
      {
        // Under single sign-on, email codes and passkeys are off. Site admins
        // keep an email code, as the way in when the provider is down.
        matcher: (ctx) =>
          Boolean(settings.sso) &&
          Boolean(
            ctx.path?.startsWith('/email-otp/') ||
            ctx.path === '/sign-in/email-otp' ||
            ctx.path?.startsWith('/passkey/'),
          ),
        handler: createAuthMiddleware(async (ctx) => {
          const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? '')
          if (ctx.path.startsWith('/passkey/') || !isSiteAdmin(settings, email)) {
            throw new APIError('FORBIDDEN', {
              message: `this site signs in with ${settings.sso?.name ?? 'single sign-on'}`,
            })
          }
        }),
      },
      {
        // A passkey can only be added right after an email-code sign-in.
        matcher: (ctx) =>
          ctx.path === '/passkey/generate-register-options' || ctx.path === '/passkey/verify-registration',
        handler: createAuthMiddleware(async (ctx) => {
          const session = (await getSessionFromCtx(ctx))?.session as
            | { signInMethod?: string; createdAt: Date }
            | undefined
          const fresh =
            session?.signInMethod === 'email-otp' &&
            Date.now() - new Date(session.createdAt).getTime() < PASSKEY_WINDOW_MS
          if (!fresh) {
            throw new APIError('FORBIDDEN', { message: 'add a passkey right after signing in with an email code' })
          }
        }),
      },
      {
        // Personal tokens carry a purpose; site admin tokens are only for site
        // admins and need a reason. Neither can claim admin powers in metadata.
        matcher: (ctx) => ctx.path === '/api-key/create' || ctx.path === '/api-key/update',
        handler: createAuthMiddleware(async (ctx) => {
          const body = (ctx.body ?? {}) as { configId?: string; metadata?: Record<string, unknown> }
          const meta = body.metadata ?? {}
          if ('site_admin' in meta) {
            throw new APIError('BAD_REQUEST', { message: 'tokens cannot carry site admin powers' })
          }
          if (ctx.path === '/api-key/update') {
            return
          }
          if (body.configId === 'admin') {
            const session = await getSessionFromCtx(ctx)
            if (!session || !settings.siteAdmins.has(session.user.email)) {
              throw new APIError('FORBIDDEN', { message: 'only site admins can make site admin tokens' })
            }
            if (typeof meta.reason !== 'string' || meta.reason.trim().length < 5) {
              throw new APIError('BAD_REQUEST', { message: 'a site admin token needs a reason' })
            }
            return
          }
          if (body.configId !== 'personal') {
            throw new APIError('BAD_REQUEST', { message: 'a token is personal (or, for site admins, admin)' })
          }
          const policy = settings.personalTokens ?? 'admins'
          if (policy !== 'on') {
            const session = await getSessionFromCtx(ctx)
            if (policy === 'off' || !session || !settings.siteAdmins.has(session.user.email.toLowerCase())) {
              throw new APIError('FORBIDDEN', {
                message:
                  policy === 'off'
                    ? 'personal tokens are turned off on this site: sign in with `ideaf auth login` instead'
                    : 'only site admins can make personal tokens on this site: sign in with `ideaf auth login` instead',
              })
            }
          }
          if (meta.grant !== undefined) {
            // limits chosen first (POST /ideaf/token-grant); they must be the maker's own
            const session = await getSessionFromCtx(ctx)
            const grant = typeof meta.grant === 'string' && deps ? await deps.grants.tokenGrant(meta.grant) : null
            if (!grant || !session || grant.user !== session.user.id) {
              throw new APIError('BAD_REQUEST', { message: 'no such token grant of yours' })
            }
            return
          }
          const purpose = String(meta.purpose ?? 'me')
          if (!(PURPOSES as readonly string[]).includes(purpose)) {
            throw new APIError('BAD_REQUEST', { message: 'a token’s purpose is me, bot-for-me or bot' })
          }
          if (purpose !== 'me' && !BOT_NAME.test(String(meta.bot ?? ''))) {
            throw new APIError('BAD_REQUEST', {
              message: 'a bot token needs a bot name: lowercase letters, digits and dashes',
            })
          }
        }),
      },
    ],
  },
})

const signInMethod = (path: string | undefined) =>
  path === '/sign-in/email-otp'
    ? 'email-otp'
    : path?.startsWith('/passkey')
      ? 'passkey'
      : path?.startsWith('/sso/')
        ? 'sso'
        : (path ?? 'other')

export function authOptions(database: BetterAuthOptions['database'], settings: AuthSettings, deps?: AuthDeps) {
  const hooks = deps?.users
  return {
    baseURL: settings.baseURL,
    basePath: '/api/auth',
    secret: settings.secret,
    database,
    // ours, and the identity provider's (read live, like the rest of the single sign-on settings)
    trustedOrigins: () => trustedOrigins(settings),
    // No passwords.
    emailAndPassword: { enabled: false },
    user: {
      // The primary email can't be changed.
      changeEmail: { enabled: false },
      additionalFields: {
        inactive: { type: 'boolean', defaultValue: false, input: false, required: false },
        handleConfirmed: { type: 'boolean', defaultValue: true, input: false, required: false },
      },
    },
    session: {
      // No cookie cache: every session read is current (an inactive account is out at once).
      cookieCache: { enabled: false },
      additionalFields: {
        signInMethod: { type: 'string', required: false, input: false },
        /** The token grant chosen for the OAuth consent about to be given. */
        oauthGrant: { type: 'string', required: false, input: false },
      },
    },
    // In memory, inside the directory actor: one count for the whole site.
    rateLimit: { enabled: settings.rateLimit !== false, storage: 'memory' },
    // Better Auth runs in the directory actor and never sees who connected: the
    // app node works out the client's address and sends it in this header
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // email-code sign-up brings the handle as `username`; the plugin's
            // own validator doesn't run on that path, so it's checked here
            let handle = (user as { username?: string }).username
            // single sign-on and SCIM bring none: suggest one, to confirm on the first visit
            if (!handle && (ctx?.path?.startsWith('/sso/') || ctx?.path?.startsWith('/scim/'))) {
              // a suggestion that's someone's parked handle is replaced once the
              // account is made (in-directory.ts): the directory can't be asked here
              handle = await suggestHandle(user.email, (await getCurrentAdapter(ctx.context.adapter)) as never)
              return { data: { ...user, username: handle, displayUsername: handle, handleConfirmed: false } }
            }
            if (!handle || !validHandle(handle)) {
              throw new APIError('BAD_REQUEST', {
                message:
                  'a new account needs a handle: 2 to 39 lowercase letters, digits and dashes, not at either end',
              })
            }
            return { data: { ...user, username: handle, displayUsername: handle } }
          },
          ...(hooks ? { after: async (user) => hooks.created(user as AuthUser) } : {}),
        },
        ...(hooks
          ? {
              update: {
                after: async (user, ctx) =>
                  hooks.updated(user as AuthUser, { confirmed: ctx?.path === '/ideaf/confirm-handle' }),
              },
            }
          : {}),
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const user = ctx ? await ctx.context.internalAdapter.findUserById(session.userId) : null
            if ((user as { inactive?: boolean } | null)?.inactive) {
              throw new APIError('FORBIDDEN', { message: 'this account is inactive' })
            }
            return { data: { ...session, signInMethod: signInMethod(ctx?.path) } }
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 3,
        sendVerificationOTP: async ({ email, otp, type }) => {
          try {
            await settings.mailer.sendCode(email, otp, type)
          } catch (error) {
            console.error(`sending a sign-in code to ${email} failed:`, error)
            ;(await unsentCode.get()).failed = true
          }
        },
      }),
      username({
        minUsernameLength: 2,
        maxUsernameLength: 39,
        usernameValidator: validHandle,
        usernameNormalization: false,
        // a handle can change: the old one keeps leading to its person (the directory's handle aliases)
        immutableUsername: false,
      }),
      jwt({
        // kept in the directory, the private key encrypted with the auth secret
        jwks: {
          keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' },
          rotationInterval: SIGNING_KEY_ROTATION_SECONDS,
          gracePeriod: SIGNING_KEY_GRACE_SECONDS,
        },
        jwt: {
          issuer: settings.baseURL,
          audience: settings.baseURL,
          expirationTime: '15m',
          // a session's JWT (GET /api/auth/token): who, as themselves; no roles
          definePayload: ({ user, session }) => {
            if ((user as { inactive?: boolean }).inactive) {
              throw new APIError('UNAUTHORIZED', { message: 'this account is inactive' })
            }
            return { purpose: 'me', sid: session.id }
          },
        },
      }),
      passkey({ rpID: new URL(settings.baseURL).hostname, rpName: 'Ideation Factory', origin: settings.baseURL }),
      apiKey([
        {
          configId: 'personal',
          defaultPrefix: 'ideaf_',
          requireName: true,
          enableMetadata: true,
          keyExpiration: { defaultExpiresIn: YEAR_SECONDS, maxExpiresIn: YEAR_SECONDS / 86400, minExpiresIn: 1 },
          // or every use would be counted in the directory
          rateLimit: { enabled: false },
        },
        {
          configId: 'admin',
          defaultPrefix: 'ideaf_admin_',
          requireName: true,
          enableMetadata: true,
          keyExpiration: {
            defaultExpiresIn: ADMIN_TOKEN_SECONDS,
            maxExpiresIn: ADMIN_TOKEN_SECONDS / 86400,
            minExpiresIn: 1,
          },
          rateLimit: { enabled: false },
        },
      ] as never),
      // the OAuth provider, with the hosted MCP server as a second resource (and its discovery document)
      mcp({
        resource: `${settings.baseURL}${MCP_PATH}`,
        loginPage: '/login',
        consentPage: '/consent',
        // offline_access for a refresh token (what a client asking for nothing gets), and the
        // OpenID scopes some MCP clients ask for, so their sign-in isn't refused
        scopes: ['offline_access', 'openid', 'profile', 'email'],
        // two resources, each with JWT access tokens for it, checked by signature: the API, and the MCP server
        resources: [settings.baseURL],
        enforcePerClientResources: false,
        accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
        allowDynamicClientRegistration: false,
        postLogin: {
          page: '/consent',
          shouldRedirect: () => false,
          // the consent's reference is the token grant chosen on the consent page
          consentReferenceId: ({ session }) => (session as { oauthGrant?: string | null }).oauthGrant ?? undefined,
        },
        // on every access token, refreshes included: the grant decides, and a
        // revoked grant (or an inactive account) gets no new token
        customAccessTokenClaims: async ({ user, referenceId }) => {
          if (!user || (user as { inactive?: boolean }).inactive) {
            throw new APIError('UNAUTHORIZED', { message: 'this account is inactive' })
          }
          const grant = referenceId && deps ? await deps.grants.tokenGrant(referenceId) : null
          if (!grant || grant.user !== user.id) {
            throw new APIError('UNAUTHORIZED', { message: 'this sign-in was revoked: sign in again' })
          }
          return grantClaims(grant)
        },
      }),
      // MCP clients identify themselves by a URL to their metadata, fetched safely and cached
      cimd({
        fetchClientMetadataResource: settings.mcp?.fetchClientMetadata ?? fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
        ...(settings.mcp?.clientHosts
          ? { isMetadataDocumentUrlAllowed: clientHostAllowed(settings.mcp.clientHosts) }
          : {}),
      }),
      sso({
        // the provider comes from the settings, never registered at runtime
        providersLimit: 0,
        get defaultSSO() {
          return ssoProviders(settings)
        },
        resolveUser: resolveSsoUser(settings, hooks) as never,
        saml: { enableInResponseToValidation: true },
      }),
      // its types don't fit BetterAuthPlugin under exactOptionalPropertyTypes; it runs as one
      scim({
        // one connection, the identity provider's, with the bearer token from the settings
        connections: [{ id: 'idp', credentials: [] }],
        authentication: {
          verifyBearerToken: ({ token }) =>
            settings.scimToken && sameSecret(token, settings.scimToken)
              ? { connectionId: 'idp', credentialId: 'settings', scopes: ['scim.users.read', 'scim.users.write'] }
              : null,
        },
        identity: {
          // someone who already has an account (say, from before single sign-on) is linked, not duplicated
          resolveUser: async ({ resource }, { database }) => {
            const email = resource.primaryEmail?.toLowerCase()
            const user = email
              ? ((await database.findOne({
                  model: 'user',
                  where: [{ field: 'email', value: email }],
                })) as UserRow | null)
              : null
            return user ? { action: 'link', userId: user.id, profile: 'manage' } : { action: 'create' }
          },
          // removed or suspended at the provider: inactive here, signed out everywhere
          reconcileUser: async ({ userId, active }, { database }) => {
            const db = database as unknown as Adapter
            await db.update({ model: 'user', where: [{ field: 'id', value: userId }], update: { inactive: !active } })
            if (!active) {
              await db.deleteMany({ model: 'session', where: [{ field: 'userId', value: userId }] })
            }
            await syncAfterCommit(db, hooks, userId)
          },
        },
      }) as unknown as BetterAuthPlugin,
      rules(settings, deps),
    ],
  } satisfies BetterAuthOptions
}

export function makeAuth(database: BetterAuthOptions['database'], settings: AuthSettings, deps?: AuthDeps) {
  return betterAuth(authOptions(database, settings, deps))
}
export type Auth = ReturnType<typeof makeAuth>
