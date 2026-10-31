// The HTTP API: every operation from @ideaf/api, routed and validated by its
// definition, plus /health and /openapi.json. Step 6 replaces the dev tokens
// with real sign-in.
import { type Caller, createRouter, openApiDocument, operations } from '@ideaf/api'
import type { Client } from 'rivetkit/client'
import { DIRECTORY_KEY } from './actors/directory.ts'
import { createHandlers } from './operations.ts'
import type { Registry } from './registry.ts'

export type AppDeps = {
  actors: Client<Registry>
  devToken: string
  /** Check every response against its schema (tests turn this on). */
  validateOutput?: boolean
}

const DEV_HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/

export function createApp({
  actors,
  devToken,
  validateOutput = false,
}: AppDeps): (request: Request) => Promise<Response> {
  const openapi = openApiDocument(operations, { title: 'Ideation Factory', version: '0.0.0' })
  const directory = actors.directory.getOrCreate(DIRECTORY_KEY)
  const known = new Set<string>()

  /**
   * Development sign-in until step 6: "Bearer <token>" is the user "dev", and
   * "Bearer <token>:<handle>" is that user, so several people can be tried. Each
   * is added to the directory the first time they're seen.
   */
  const authenticate = async (request: Request): Promise<Caller | null> => {
    const header = request.headers.get('authorization') ?? ''
    if (!header.startsWith(`Bearer ${devToken}`)) {
      return null
    }
    const rest = header.slice(`Bearer ${devToken}`.length)
    const handle = rest === '' ? 'dev' : rest.startsWith(':') ? rest.slice(1) : null
    if (!handle || !DEV_HANDLE.test(handle)) {
      return null
    }
    if (!known.has(handle)) {
      await directory.ensureUser({ id: handle, handle, name: handle })
      known.add(handle)
    }
    return { user: handle, bot: null, purpose: 'me' }
  }

  const route = createRouter(operations, createHandlers(actors), {
    authenticate,
    validateOutput,
    onError: (error, operation) => console.error(`${operation} failed:`, error),
  })
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') {
      return Response.json({ ok: true })
    }
    if (pathname === '/openapi.json') {
      return Response.json(openapi)
    }
    return (
      (await route(request)) ??
      Response.json({ error: { code: 'not_found', message: 'no such route' } }, { status: 404 })
    )
  }
}
