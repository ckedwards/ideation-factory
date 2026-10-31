// The HTTP API: every operation from @ideaf/api, routed and validated by its
// definition, plus /health and /openapi.json. Step 6 replaces the dev token
// with real sign-in.
import { type Caller, createRouter, openApiDocument, operations } from '@ideaf/api'
import type { Client } from 'rivetkit/client'
import { createHandlers } from './operations.ts'
import type { Registry } from './registry.ts'

export type AppDeps = {
  actors: Client<Registry>
  devToken: string
  /** Check every response against its schema (tests turn this on). */
  validateOutput?: boolean
}

const DEV_CALLER: Caller = { user: 'dev', bot: null, purpose: 'me' }

export function createApp({ actors, devToken, validateOutput = false }: AppDeps): (request: Request) => Promise<Response> {
  const openapi = openApiDocument(operations, { title: 'Ideation Factory', version: '0.0.0' })
  const route = createRouter(operations, createHandlers(actors), {
    authenticate: async (request) => (request.headers.get('authorization') === `Bearer ${devToken}` ? DEV_CALLER : null),
    validateOutput,
    onError: (error, operation) => console.error(`${operation} failed:`, error),
  })
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return Response.json({ ok: true })
    if (pathname === '/openapi.json') return Response.json(openapi)
    return (await route(request)) ?? Response.json({ error: { code: 'not_found', message: 'no such route' } }, { status: 404 })
  }
}
