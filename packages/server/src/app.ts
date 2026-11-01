// The HTTP API: every operation from @ideaf/api, routed and validated by its
// definition, plus sign-in (forwarded to Better Auth in the directory actor),
// a bare sign-in page, /health and /openapi.json.
import { createRouter, openApiDocument, operations } from '@ideaf/api'
import type { Client } from 'rivetkit/client'
import { DIRECTORY_KEY } from './actors/directory.ts'
import type { AuthSettings } from './auth/config.ts'
import { authGateway } from './auth/gateway.ts'
import { cliCodePage, consentPage, loginPage } from './auth/pages.ts'
import { CLI_CODE_PATH } from './auth/config.ts'
import { createHandlers } from './operations.ts'
import type { Registry } from './registry.ts'

export type AppDeps = {
  actors: Client<Registry>
  /** The same settings the directory actor's Better Auth runs with: its base URL is the tokens' issuer. */
  auth: Pick<AuthSettings, 'baseURL'>
  /** Check every response against its schema (tests turn this on). */
  validateOutput?: boolean
}

export function createApp({ actors, auth, validateOutput = false }: AppDeps): (request: Request) => Promise<Response> {
  const openapi = openApiDocument(operations, { title: 'Ideation Factory', version: '0.0.0' })
  const directory = actors.directory.getOrCreate(DIRECTORY_KEY)
  const gateway = authGateway(directory, auth.baseURL)

  const route = createRouter(operations, createHandlers(actors), {
    authenticate: gateway.authenticate,
    validateOutput,
    onError: (error, operation) => console.error(`${operation} failed:`, error),
  })
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') {
      return Response.json({ ok: true })
    }
    if (pathname.startsWith('/api/auth/')) {
      return gateway.forward(request)
    }
    if (pathname === '/login') {
      return loginPage()
    }
    if (pathname === '/consent') {
      return consentPage()
    }
    if (pathname === CLI_CODE_PATH) {
      return cliCodePage()
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
