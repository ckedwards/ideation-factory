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
import { type BetterAuthOptions, betterAuth } from 'better-auth'
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

const SITE_ADMINS = new Set((process.env.SITE_ADMINS ?? 'admin@example.com').split(','))
const PASSKEY_WINDOW_MS = 5 * 60 * 1000
const YEAR_S = 365 * 24 * 3600
const ADMIN_MAX_S = 30 * 24 * 3600

// Our own endpoints, as a Better Auth plugin so they share its sessions and API.
const ideafRules = () =>
  ({
    id: 'ideaf-rules',
    endpoints: {
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

export const jwtOptions = {
  jwks: { keyPairConfig: { alg: 'EdDSA' as const, crv: 'Ed25519' as const } },
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
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const handle = (user as { username?: string }).username
            if (!handle || !validHandle(handle)) throw new APIError('BAD_REQUEST', { message: 'a valid handle is required' })
            return { data: { ...user, displayUsername: handle } }
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const user = ctx ? await ctx.context.internalAdapter.findUserById(session.userId) : null
            if (user && (user as { inactive?: boolean }).inactive) throw new APIError('FORBIDDEN', { message: 'this account is inactive' })
            const method = ctx?.path === '/sign-in/email-otp' ? 'email-otp' : ctx?.path?.startsWith('/passkey') ? 'passkey' : (ctx?.path ?? 'other')
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
      ideafRules(),
    ],
  } satisfies BetterAuthOptions
}

export function makeAuth(database: BetterAuthOptions['database']) {
  return betterAuth(authOptions(database))
}
export type Auth = ReturnType<typeof makeAuth>
