// Better Auth's configuration: sign-in with an email code or a passkey (never a
// password), handles, 15-minute JWTs, and personal and site admin tokens. Our
// account rules are configuration plus the hooks and the small plugin below;
// nothing in the library is patched. It runs inside the directory actor (see
// actors/directory.ts), on its own tables there. It's also the OAuth
// authorization server: the cli signs in with the authorization code flow, and
// each token's purpose and limits come from the token grant chosen on the
// consent page. Single sign-on, SCIM and MCP clients (CIMD) come later.
//
// Worked out in the Better Auth spike: docs/mvp/spike-better-auth.md.
import { apiKey } from '@better-auth/api-key'
import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from 'better-auth'
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
}

export const PERSONAL_TOKEN_POLICIES = ['on', 'admins', 'off'] as const
export type PersonalTokenPolicy = (typeof PERSONAL_TOKEN_POLICIES)[number]

/** What the directory does when Better Auth adds or changes a person. */
export interface UserHooks {
  created(user: AuthUser): Promise<void>
  updated(user: AuthUser): Promise<void>
}

/** The directory, as Better Auth reaches it from inside the actor. */
export interface AuthDeps {
  users: UserHooks
  grants: Pick<Directory, 'createTokenGrant' | 'tokenGrant'>
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
        },
      }
    : {}),
  hooks: {
    after: [
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
  path === '/sign-in/email-otp' ? 'email-otp' : path?.startsWith('/passkey') ? 'passkey' : (path ?? 'other')

export function authOptions(database: BetterAuthOptions['database'], settings: AuthSettings, deps?: AuthDeps) {
  const hooks = deps?.users
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
        /** The token grant chosen for the OAuth consent about to be given. */
        oauthGrant: { type: 'string', required: false, input: false },
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
      oauthProvider({
        loginPage: '/login',
        consentPage: '/consent',
        scopes: ['offline_access'],
        // the API is the one resource: its access tokens are JWTs for it, checked by signature
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
      rules(settings, deps),
    ],
  } satisfies BetterAuthOptions
}

export function makeAuth(database: BetterAuthOptions['database'], settings: AuthSettings, deps?: AuthDeps) {
  return betterAuth(authOptions(database, settings, deps))
}
export type Auth = ReturnType<typeof makeAuth>
