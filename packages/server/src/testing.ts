// Starting the actors for tests: once per test process, on this worktree's own
// Rivet Engine. Refuses to run without the worktree's settings, which only
// `bun run test` provides (RivetKit reads them before any code runs, so they
// can't be set from here); otherwise the engine's data would go to ~/.rivetkit
// and the engine would be shared with other worktrees.
import { createClient, type Client } from 'rivetkit/client'
import type { AuthSettings } from './auth/config.ts'
import { CapturingMailer } from './auth/settings.ts'
import { inProcessCore } from './core-pool/runner.ts'
import { configureNode, type NodeDeps } from './deps.ts'
import { MemoryFileStore } from './files/memory.ts'
import { DEFAULT_LIMITS } from './limits.ts'
import { registry, type Registry } from './registry.ts'

let started: Promise<Client<Registry>> | null = null

/** Where tests reach the app, and the sign-in codes it sends. */
export const TEST_URL = 'http://ideaf.test'
export const testMailer = new CapturingMailer()
export const TEST_ADMIN = 'admin@example.test'
export const testAuth: AuthSettings = {
  baseURL: TEST_URL,
  secret: 'ideaf-test-secret-0123456789abcdef-0123456789',
  siteAdmins: new Set([TEST_ADMIN]),
  mailer: testMailer,
  rateLimit: false,
}

export function startTestActors(deps: Partial<NodeDeps> = {}): Promise<Client<Registry>> {
  if (!process.env.RIVETKIT_STORAGE_PATH || !process.env.RIVET_RUN_ENGINE_PORT) {
    throw new Error('run the tests with `bun run test`: it gives this worktree its own Rivet Engine and data folder')
  }
  // index rows catch up quickly in tests
  process.env.IDEAF_INDEX_DELAY_MS ??= '100'
  configureNode({
    files: new MemoryFileStore(),
    core: inProcessCore(),
    limits: DEFAULT_LIMITS,
    auth: testAuth,
    ...deps,
  })
  started ??= (async () => {
    registry.config.noWelcome = true
    await registry.startAndWait()
    return createClient<Registry>(registry.parseConfig().endpoint!)
  })()
  return started
}

type App = (request: Request) => Promise<Response>
/** A signed-in test person: their session cookie, a personal token, and a 15-minute access token from exchanging it. */
export type SignedIn = { id: string; handle: string; email: string; cookie: string; token: string; jwt: string }
const signedIn = new WeakMap<App, Map<string, Promise<SignedIn>>>()

/**
 * Signs up (or in) as this handle through the real flow: an email code to
 * <handle>@example.test, then a personal token made with the session and
 * exchanged for an access token. Once per handle per app; `email` overrides the address (for a site admin, say).
 */
export function signIn(app: App, handle: string, email = `${handle}@example.test`): Promise<SignedIn> {
  let known = signedIn.get(app)
  if (!known) {
    known = new Map()
    signedIn.set(app, known)
  }
  let found = known.get(handle)
  if (!found) {
    found = (async () => {
      const post = async (path: string, body: unknown, cookie?: string) => {
        const response = await app(
          new Request(`${TEST_URL}${path}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: TEST_URL,
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify(body),
          }),
        )
        if (!response.ok) {
          throw new Error(`${path} failed (${response.status}): ${await response.text()}`)
        }
        return response
      }
      await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
      const session = await post('/api/auth/sign-in/email-otp', {
        email,
        otp: testMailer.code(email),
        username: handle,
        name: handle,
      })
      const cookie = session.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ')
      const { user } = (await session.json()) as { user: { id: string } }
      const key = (await (
        await post(
          '/api/auth/api-key/create',
          { configId: 'personal', name: 'tests', metadata: { purpose: 'me' } },
          cookie,
        )
      ).json()) as { key: string }
      const { access_token } = (await (await post('/ideaf/token', { token: key.key })).json()) as {
        access_token: string
      }
      return { id: user.id, handle, email, cookie, token: key.key, jwt: access_token }
    })()
    known.set(handle, found)
  }
  return found
}
