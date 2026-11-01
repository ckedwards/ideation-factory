// The Better Auth configuration under test: email codes and passkeys only,
// handles, 15-minute JWTs, the MCP authorization server with CIMD, device
// login for the cli, and personal and site admin tokens. Our account rules are
// configuration plus the hooks and one small plugin (ideafRules) below; nothing
// in the library is patched.
import { apiKey } from '@better-auth/api-key'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { mcp } from '@better-auth/mcp'
import { oauthDeviceAuthorization } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { scim } from '@better-auth/scim'
import { sso } from '@better-auth/sso'
import { type BetterAuthOptions, betterAuth, getCurrentAdapter } from 'better-auth'
import { APIError, createAuthEndpoint, createAuthMiddleware, sessionMiddleware } from 'better-auth/api'
import { emailOTP, jwt, username } from 'better-auth/plugins'
import * as z from 'zod'

export const BASE = process.env.IDEAF_URL ?? 'http://localhost:25445'
export const MCP_RESOURCE = `${BASE}/mcp`
export const ACCESS_TOKEN_SECONDS = 15 * 60

/** CIMD metadata fetches through the transport, for the caching checks. */
export const cimdFetches: { url: string; outcome: string }[] = []
const countedFetch: typeof fetchClientMetadataResource = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  try {
    const r = await fetchClientMetadataResource(input, init)
    cimdFetches.push({ url, outcome: String(r.status) })
    return r
  } catch (e) {
    cimdFetches.push({ url, outcome: `refused: ${(e as Error).message}` })
    throw e
  }
}

/** The fake email sender: codes are logged and kept here for tests. */
export const outbox: { email: string; otp: string; type: string }[] = []

/** Purposes, as chosen on the consent screen, kept in the consent's referenceId. */
export type Purpose = { purpose: 'me' } | { purpose: 'bot-for-me'; bot: string } | { purpose: 'bot'; bot: string }
export function encodePurpose(p: Purpose): string {
  return p.purpose === 'me' ? 'me' : `${p.purpose}:${p.bot}`
}
export function decodePurpose(ref: string | undefined | null): Purpose {
  if (!ref || ref === 'me') return { purpose: 'me' }
  const [purpose, bot] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)]
  if ((purpose === 'bot-for-me' || purpose === 'bot') && bot) return { purpose, bot }
  return { purpose: 'me' }
}

// Handles: 2–39 characters, lowercase letters and numbers, with . - _ allowed
// only in the middle; some words reserved.
export const RESERVED = new Set(['admin', 'api', 'auth', 'mcp', 'me', 'new', 'settings', 'login', 'logout', 'help', 'support', 'root', 'system', 'ideaf'])
export function validHandle(h: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$/.test(h) && h.length >= 2 && !RESERVED.has(h)
}

export const SITE_ADMINS = new Set((process.env.SITE_ADMINS ?? 'admin@example.com').split(','))
const PASSKEY_WINDOW_MS = 5 * 60 * 1000
const YEAR_S = 365 * 24 * 3600
const ADMIN_MAX_S = 30 * 24 * 3600

// ---------------------------------------------------------------------------
// Single sign-on. One identity provider for the whole deployment, set by the
// site admin; no tenants. SPIKE_SSO=1 turns the deployment over to it: email
// codes and passkeys stop working, except an email code for site admins (the
// break-glass way in when the provider is down).
//
// Two ways to configure the provider are tried: OIDC in config (defaultSSO,
// install-time), and SAML registered at runtime by a site admin
// (POST /sso/register, stored in ssoProvider), as a Site admin page would.
export const SSO_MODE = process.env.SPIKE_SSO === '1'
export const KC_URL = process.env.KC_URL ?? 'http://localhost:25447'
export const KC_REALM = `${KC_URL}/realms/ideaf`
export const OIDC_PROVIDER = 'acme-oidc'
export const SAML_PROVIDER = 'acme-saml'
/** Allowed email domains; only these can sign in with single sign-on. */
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS ?? 'acme.test').split(',')
/** Create accounts automatically (just-in-time). Off: a site admin invites people first. */
const SSO_JIT = process.env.SSO_JIT !== '0'
export const SCIM_TOKEN = process.env.SCIM_TOKEN ?? 'spike-scim-token-spike-scim-token-0123'

type Db = {
  findOne: (a: { model: string; where: { field: string; value: unknown }[] }) => Promise<Record<string, unknown> | null>
  findMany: (a: { model: string; where?: { field: string; value: unknown }[] }) => Promise<Record<string, unknown>[]>
  update: (a: { model: string; where: { field: string; value: unknown }[]; update: Record<string, unknown> }) => Promise<unknown>
  updateMany: (a: { model: string; where: { field: string; value: unknown }[]; update: Record<string, unknown> }) => Promise<unknown>
  deleteMany: (a: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>
}

/** A free handle suggested from an email's local part: "Jane.Doe+x@acme" → "jane.doe-x". */
export async function suggestHandle(email: string, fallback: Db): Promise<string> {
  const db = (await getCurrentAdapter(fallback as never)) as unknown as Db
  let base = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 34)
  if (base.length < 2 || RESERVED.has(base)) base = `user-${base}`.replace(/-$/, '')
  for (let n = 1; ; n++) {
    const h = n === 1 ? base : `${base}-${n}`
    if (!(await db.findOne({ model: 'user', where: [{ field: 'username', value: h }] }))) return h
  }
}

const emailDomain = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase()

/**
 * Which account a verified single sign-on identity belongs to. Runs inside the
 * sign-in's transaction (Better Auth requires a native-transaction adapter
 * for this hook).
 * 1. The provider's subject seen before → that account. If the provider's
 *    email changed, the primary email follows it ("under single sign-on the
 *    provider owns the email"), unless another account has it.
 * 2. Otherwise match on primary email, so switching an existing deployment
 *    keeps everyone's ideas, comments and tokens.
 * 3. Otherwise create an account, if automatic creation is on.
 */
export const ssoDecisions: { email: string; decision: string }[] = []
async function ssoResolveUser(
  input: { providerId: string; accountKey: { accountId: string }; providerUser: { email: string } },
  { database }: { database: unknown },
) {
  const db = database as Db
  const email = input.providerUser.email.toLowerCase()
  const decide = <T extends { action: string; code?: string }>(d: T) => (ssoDecisions.push({ email, decision: d.code ?? d.action }), d)
  if (!ALLOWED_DOMAINS.includes(emailDomain(email))) return decide({ action: 'reject' as const, code: 'domain_not_allowed', message: `${emailDomain(email)} can't sign in here` })
  const account = await db.findOne({ model: 'account', where: [{ field: 'providerId', value: input.providerId }, { field: 'accountId', value: input.accountKey.accountId }] })
  const byEmail = await db.findOne({ model: 'user', where: [{ field: 'email', value: email }] })
  if (account) {
    const user = await db.findOne({ model: 'user', where: [{ field: 'id', value: account.userId }] })
    if (!user) return decide({ action: 'reject' as const, code: 'no_account' })
    if (user.inactive) return decide({ action: 'reject' as const, code: 'inactive', message: 'this account is inactive' })
    if (byEmail && byEmail.id !== user.id) return decide({ action: 'reject' as const, code: 'email_taken', message: 'another account has this email' })
    if (user.email !== email) await db.update({ model: 'user', where: [{ field: 'id', value: user.id }], update: { email, updatedAt: new Date() } })
    return decide({ action: 'link' as const, userId: String(user.id), profile: 'preserve' as const })
  }
  if (byEmail) {
    if (byEmail.inactive) return decide({ action: 'reject' as const, code: 'inactive', message: 'this account is inactive' })
    return decide({ action: 'link' as const, userId: String(byEmail.id), profile: 'preserve' as const })
  }
  if (!SSO_JIT) return decide({ action: 'reject' as const, code: 'no_account', message: 'ask a site admin to invite you' })
  return decide({ action: 'continue' as const })
}

const ssoOptions = {
  // Only site admins can configure a provider, and only one.
  providersLimit: (user: { email: string }) => (SITE_ADMINS.has(user.email) ? 1 : 0),
  resolveUser: ssoResolveUser as never,
  saml: { enableInResponseToValidation: true },
  defaultSSO: SSO_MODE
    ? [
        {
          providerId: OIDC_PROVIDER,
          domain: 'acme.test',
          oidcConfig: {
            issuer: KC_REALM,
            discoveryEndpoint: `${KC_REALM}/.well-known/openid-configuration`,
            clientId: 'ideaf-oidc',
            clientSecret: process.env.OIDC_SECRET ?? 'spike-oidc-secret',
            pkce: true,
            scopes: ['openid', 'email', 'profile'],
          },
        },
      ]
    : [],
}

/**
 * SCIM from the identity provider (Okta, Entra): people removed there become
 * inactive here, with their sessions and refresh tokens gone, and new people
 * can be created ahead of their first sign-in.
 */
const scimOptions = {
  connections: [{ id: 'acme', credentials: [{ type: 'bearer' as const, id: 'idp', token: SCIM_TOKEN }] }],
  identity: {
    // Link an incoming SCIM user to an existing account by primary email. The
    // SCIM credential is held only by the site admin's own identity provider.
    resolveUser: async (input: { resource: { primaryEmail: string } }, { database }: { database: unknown }) => {
      const u = await (database as Db).findOne({ model: 'user', where: [{ field: 'email', value: input.resource.primaryEmail.toLowerCase() }] })
      return u ? { action: 'link' as const, userId: String(u.id), profile: 'preserve' as const } : { action: 'create' as const }
    },
    reconcileUser: async (state: { userId: string; active: boolean }, { database }: { database: unknown }) => {
      const db = database as Db
      await db.update({ model: 'user', where: [{ field: 'id', value: state.userId }], update: { inactive: !state.active } })
      if (!state.active) {
        await db.deleteMany({ model: 'session', where: [{ field: 'userId', value: state.userId }] })
        await db.updateMany({ model: 'oauthRefreshToken', where: [{ field: 'userId', value: state.userId }], update: { revoked: new Date() } })
      }
    },
  },
}

// Our own endpoints, as a Better Auth plugin so they share its sessions and API.
const ideafRules = () =>
  ({
    id: 'ideaf-rules',
    endpoints: {
      // First visit after single sign-on created the account: keep or change
      // the suggested handle, once. After that it's fixed like any other.
      confirmHandle: createAuthEndpoint(
        '/ideaf/confirm-handle',
        { method: 'POST', use: [sessionMiddleware], body: z.object({ handle: z.string() }) },
        async (ctx) => {
          const user = ctx.context.session.user as { id: string; username?: string; handleConfirmed?: boolean }
          if (user.handleConfirmed !== false) throw new APIError('BAD_REQUEST', { message: 'your handle is already set' })
          const handle = ctx.body.handle
          if (!validHandle(handle)) throw new APIError('BAD_REQUEST', { message: 'not a valid handle' })
          if (handle !== user.username && (await ctx.context.adapter.findOne({ model: 'user', where: [{ field: 'username', value: handle }] })))
            throw new APIError('BAD_REQUEST', { message: 'that handle is taken' })
          await ctx.context.internalAdapter.updateUser(user.id, { username: handle, displayUsername: handle, handleConfirmed: true })
          return ctx.json({ ok: true, handle })
        },
      ),
      // The consent page records the purpose on the session just before it
      // consents; consentReferenceId reads it back (see mcp() below).
      setOAuthPurpose: createAuthEndpoint(
        '/ideaf/oauth-purpose',
        {
          method: 'POST',
          use: [sessionMiddleware],
          body: z.object({ purpose: z.enum(['me', 'bot-for-me', 'bot']), bot: z.string().regex(/^[a-z0-9][a-z0-9-]{0,38}$/).optional() }),
        },
        async (ctx) => {
          const { purpose, bot } = ctx.body
          if (purpose !== 'me' && !bot) throw new APIError('BAD_REQUEST', { message: 'a bot needs a name' })
          const ref = encodePurpose(purpose === 'me' ? { purpose } : { purpose, bot: bot! })
          await ctx.context.internalAdapter.updateSession(ctx.context.session.session.token, { oauthPurpose: ref })
          return ctx.json({ ok: true, ref })
        },
      ),
    },
    hooks: {
      before: [
        {
          // Under single sign-on, email codes and passkeys are off. Site admins
          // keep an email code, as the way in when the provider is down.
          matcher: (ctx) => SSO_MODE && (ctx.path?.startsWith('/email-otp/') || ctx.path === '/sign-in/email-otp' || ctx.path?.startsWith('/passkey/')),
          handler: createAuthMiddleware(async (ctx) => {
            const email = String((ctx.body as { email?: string } | undefined)?.email ?? '').toLowerCase()
            if (ctx.path?.startsWith('/passkey/') || !SITE_ADMINS.has(email))
              throw new APIError('FORBIDDEN', { message: 'this site signs in with single sign-on' })
          }),
        },
        {
          // Passkeys can only be added right after an email-code sign-in.
          matcher: (ctx) => ctx.path === '/passkey/generate-register-options' || ctx.path === '/passkey/verify-registration',
          handler: createAuthMiddleware(async (ctx) => {
            const { getSessionFromCtx } = await import('better-auth/api')
            const s = await getSessionFromCtx(ctx)
            const sess = s?.session as { signInMethod?: string; createdAt: Date } | undefined
            const fresh = sess && sess.signInMethod === 'email-otp' && Date.now() - new Date(sess.createdAt).getTime() < PASSKEY_WINDOW_MS
            if (!fresh) throw new APIError('FORBIDDEN', { message: 'add a passkey right after signing in with an email code' })
          }),
        },
        {
          // Personal tokens carry a purpose; site admin tokens are only for
          // site admins and need a reason. Neither can claim admin in metadata.
          matcher: (ctx) => ctx.path === '/api-key/create' || ctx.path === '/api-key/update',
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as { configId?: string; metadata?: Record<string, unknown>; userId?: string }
            const meta = body.metadata ?? {}
            if ('site_admin' in meta) throw new APIError('BAD_REQUEST', { message: 'tokens cannot carry site admin powers' })
            if (ctx.path === '/api-key/update') return
            if (body.configId === 'admin') {
              const { getSessionFromCtx } = await import('better-auth/api')
              const s = await getSessionFromCtx(ctx)
              if (!s || !SITE_ADMINS.has(s.user.email)) throw new APIError('FORBIDDEN', { message: 'only site admins' })
              if (typeof meta.reason !== 'string' || meta.reason.trim().length < 5) throw new APIError('BAD_REQUEST', { message: 'a site admin token needs a reason' })
              return
            }
            if (body.configId !== 'personal') throw new APIError('BAD_REQUEST', { message: 'unknown token kind' })
            const purpose = meta.purpose ?? 'me'
            if (!['me', 'bot-for-me', 'bot'].includes(String(purpose))) throw new APIError('BAD_REQUEST', { message: 'bad purpose' })
            if (purpose !== 'me' && !/^[a-z0-9][a-z0-9-]{0,38}$/.test(String(meta.bot ?? ''))) throw new APIError('BAD_REQUEST', { message: 'a bot needs a name' })
          }),
        },
      ],
    },
  }) as const

// Signing keys are read from storage at most every 5 minutes per process
// (SPIKE_CACHE=0 turns this off, to measure the difference). A rotation is
// picked up within that window.
const JWKS_TTL_MS = 5 * 60_000
let jwksCache: { at: number; keys: unknown[] } | null = null
const cacheOn = process.env.SPIKE_CACHE !== '0'
export const jwtOptions = {
  jwks: { keyPairConfig: { alg: 'EdDSA' as const, crv: 'Ed25519' as const } },
  ...(cacheOn
    ? {
        adapter: {
          getJwks: async (ctx: { context: { adapter: { findMany: (a: unknown) => Promise<unknown[]> } } }) => {
            if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys
            const keys = await ctx.context.adapter.findMany({ model: 'jwks' })
            jwksCache = { at: Date.now(), keys }
            return keys
          },
          createJwk: async (data: Record<string, unknown>, ctx: { context: { adapter: { create: (a: unknown) => Promise<unknown> } } }) => {
            jwksCache = null
            return ctx.context.adapter.create({ model: 'jwks', data: { ...data, createdAt: new Date() } })
          },
        },
      }
    : {}),
  jwt: {
    issuer: BASE,
    audience: BASE,
    expirationTime: '15m',
    // Session JWTs (GET /token): who, purpose "me", no roles.
    definePayload: ({ user, session }: { user: Record<string, unknown>; session: Record<string, unknown> }) => {
      if (user.inactive) throw new APIError('UNAUTHORIZED', { message: 'inactive' })
      return { purpose: 'me', sid: session.id }
    },
  },
}

export function authOptions(database: BetterAuthOptions['database']) {
  return {
    baseURL: BASE,
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET ?? 'spike-secret-spike-secret-spike-secret-0123456789',
    database,
    // No passwords.
    emailAndPassword: { enabled: false },
    user: {
      // The primary email can't be changed.
      changeEmail: { enabled: false },
      additionalFields: {
        inactive: { type: 'boolean', defaultValue: false, input: false, required: false },
        // False for accounts created by single sign-on or SCIM: the handle was
        // suggested from the email and the person confirms it on first visit.
        handleConfirmed: { type: 'boolean', defaultValue: true, input: false, required: false },
      },
    },
    session: {
      // No cookie cache: every session read is current (inactive, purpose).
      cookieCache: { enabled: false },
      additionalFields: {
        signInMethod: { type: 'string', required: false, input: false },
        oauthPurpose: { type: 'string', required: false, input: false },
      },
    },
    // Rate limiting in memory (the default storage), on in development too.
    rateLimit: { enabled: true, storage: 'memory' },
    // Behind the load balancer, the client IP comes from X-Forwarded-For.
    advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
    // An internal identity provider (on a private address) must be listed here.
    trustedOrigins: [KC_URL],
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            let handle = (user as { username?: string }).username
            let handleConfirmed = true
            // Single sign-on and SCIM bring a name and an email but no handle:
            // suggest one from the email, to be confirmed on first visit.
            if (!handle && ctx && (ctx.path?.startsWith('/sso/') || ctx.path?.startsWith('/scim/'))) {
              handle = await suggestHandle(user.email, ctx.context.adapter as never)
              handleConfirmed = false
            }
            if (!handle || !validHandle(handle)) throw new APIError('BAD_REQUEST', { message: 'a valid handle is required' })
            return { data: { ...user, username: handle, displayUsername: handle, handleConfirmed } }
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const user = ctx ? await ctx.context.internalAdapter.findUserById(session.userId) : null
            if (user && (user as { inactive?: boolean }).inactive) throw new APIError('FORBIDDEN', { message: 'this account is inactive' })
            const method = ctx?.path === '/sign-in/email-otp' ? 'email-otp' : ctx?.path?.startsWith('/passkey') ? 'passkey' : ctx?.path?.startsWith('/sso/') ? 'sso' : (ctx?.path ?? 'other')
            return { data: { ...session, signInMethod: method } }
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 3,
        async sendVerificationOTP({ email, otp, type }) {
          outbox.push({ email, otp, type })
          console.log(`[fake email] ${type} code for ${email}: ${otp}`)
        },
      }),
      username({
        minUsernameLength: 2,
        maxUsernameLength: 39,
        usernameValidator: validHandle,
        usernameNormalization: false,
        immutableUsername: true,
      }),
      jwt(jwtOptions as never),
      passkey({ rpID: new URL(BASE).hostname, rpName: 'Ideation Factory', origin: BASE }),
      apiKey(
        [
          {
            configId: 'personal',
            defaultPrefix: 'ideaf_',
            requireName: true,
            enableMetadata: true,
            keyExpiration: { defaultExpiresIn: YEAR_S, maxExpiresIn: YEAR_S / 86400, minExpiresIn: 1 },
            // Don't write the directory on every verify.
            rateLimit: { enabled: false },
          },
          {
            configId: 'admin',
            defaultPrefix: 'ideaf_admin_',
            requireName: true,
            enableMetadata: true,
            keyExpiration: { defaultExpiresIn: ADMIN_MAX_S, maxExpiresIn: ADMIN_MAX_S / 86400, minExpiresIn: 1 },
            rateLimit: { enabled: false },
          },
        ] as never,
      ),
      mcp({
        resource: MCP_RESOURCE,
        loginPage: '/login',
        consentPage: '/consent',
        accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
        // The MCP resource row changes only with a deploy: keep it in memory.
        ...(cacheOn ? { cachedResources: new Set([MCP_RESOURCE]) } : {}),
        scopes: ['openid', 'profile', 'email', 'offline_access', 'ideas:read', 'ideas:write'],
        // The consent screen's choice, kept as the consent's reference.
        postLogin: {
          page: '/consent',
          shouldRedirect: () => false,
          consentReferenceId: ({ session }) => (session as { oauthPurpose?: string }).oauthPurpose ?? 'me',
        },
        customAccessTokenClaims: ({ user, referenceId }) => {
          if (user && (user as { inactive?: boolean }).inactive) throw new APIError('UNAUTHORIZED', { message: 'inactive' })
          const p = decodePurpose(referenceId)
          return { purpose: p.purpose, ...('bot' in p ? { bot: p.bot } : {}), ...(user ? { name: user.name, handle: (user as { username?: string }).username } : {}) }
        },
      }),
      cimd({
        fetchClientMetadataResource: countedFetch,
        metadataProfile: 'mcp-2026-07-28',
        ...(process.env.CIMD_ALLOW ? { isMetadataDocumentUrlAllowed: (url: string) => process.env.CIMD_ALLOW!.split(',').includes(new URL(url).host) } : {}),
      }),
      oauthDeviceAuthorization({ verificationUri: `${BASE}/device` }),
      sso(ssoOptions),
      // SCIM needs native transactions, which approach 1's adapter lacks: only with SSO on.
      ...(SSO_MODE ? [scim(scimOptions)] : []),
      ideafRules(),
    ],
  } satisfies BetterAuthOptions
}

export function makeAuth(database: BetterAuthOptions['database']) {
  return betterAuth(authOptions(database))
}
export type Auth = ReturnType<typeof makeAuth>
