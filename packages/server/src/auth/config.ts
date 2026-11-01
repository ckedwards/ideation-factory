// Better Auth's configuration: sign-in with an email code or a passkey (never a
// password), handles, 15-minute JWTs, and personal and site admin tokens. Our
// account rules are configuration plus the hooks and the small plugin below;
// nothing in the library is patched. It runs inside the directory actor (see
// actors/directory.ts), on its own tables there. Single sign-on, SCIM and the
// MCP authorization server come in later slices of step 6.
//
// Worked out in the Better Auth spike: docs/mvp/spike-better-auth.md.
import { apiKey } from '@better-auth/api-key'
import { passkey } from '@better-auth/passkey'
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { emailOTP, jwt, username } from 'better-auth/plugins'

/** How a short-lived access token lasts. */
export const ACCESS_TOKEN_SECONDS = 15 * 60
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
  /** Rate limits on sign-in (on unless false: tests sign up many people from one address). */
  rateLimit?: boolean
}

/** What the directory does when Better Auth adds or changes a person. */
export interface UserHooks {
  created(user: AuthUser): Promise<void>
  updated(user: AuthUser): Promise<void>
}

export type AuthUser = { id: string; email: string; name: string; username?: string | null; inactive?: boolean | null }

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

/** Our account rules on Better Auth's endpoints, as a plugin. */
const rules = (settings: AuthSettings): BetterAuthPlugin => ({
  id: 'ideaf-rules',
  hooks: {
    before: [
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
  path === '/sign-in/email-otp' ? 'email-otp' : path?.startsWith('/passkey') ? 'passkey' : (path ?? 'other')

export function authOptions(database: BetterAuthOptions['database'], settings: AuthSettings, hooks?: UserHooks) {
  return {
    baseURL: settings.baseURL,
    basePath: '/api/auth',
    secret: settings.secret,
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
      // No cookie cache: every session read is current (an inactive account is out at once).
      cookieCache: { enabled: false },
      additionalFields: {
        signInMethod: { type: 'string', required: false, input: false },
      },
    },
    // In memory, inside the directory actor: one count for the whole site.
    rateLimit: { enabled: settings.rateLimit !== false, storage: 'memory' },
    // Behind a load balancer, the client's address comes from X-Forwarded-For.
    advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // email-code sign-up brings the handle as `username`; the plugin's
            // own validator doesn't run on that path, so it's checked here
            const handle = (user as { username?: string }).username
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
        ...(hooks ? { update: { after: async (user) => hooks.updated(user as AuthUser) } } : {}),
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
        sendVerificationOTP: ({ email, otp, type }) => settings.mailer.sendCode(email, otp, type),
      }),
      username({
        minUsernameLength: 2,
        maxUsernameLength: 39,
        usernameValidator: validHandle,
        usernameNormalization: false,
        immutableUsername: true,
      }),
      jwt({
        jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
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
      rules(settings),
    ],
  } satisfies BetterAuthOptions
}

export function makeAuth(database: BetterAuthOptions['database'], settings: AuthSettings, hooks?: UserHooks) {
  return betterAuth(authOptions(database, settings, hooks))
}
export type Auth = ReturnType<typeof makeAuth>
