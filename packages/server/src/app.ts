// The HTTP API: every operation from @ideaf/api under /api, routed and
// validated by its definition, plus sign-in (forwarded to Better Auth in the
// directory actor), the hosted MCP server (/mcp) and the OAuth discovery
// documents MCP clients read, a bare sign-in page, /health, /api/openapi.json
// and the unsubscribe links in emails. Every other path is the web app's.
import { API_PATH, createRouter, openApiDocument, operations } from '@ideaf/api'
import type { Client } from 'rivetkit/client'
import { directoryOf } from './actors/pools.ts'
import type { AuthSettings } from './auth/config.ts'
import { authGateway } from './auth/gateway.ts'
import { cliCodePage, consentPage, loginPage } from './auth/pages.ts'
import { CLI_CODE_PATH, MCP_PATH, SSO_PROVIDER_ID } from './auth/config.ts'
import { createMcp } from './mcp.ts'
import { unsubscribePage } from './mail/unsubscribe.ts'
import { createHandlers } from './operations.ts'
import type { Registry } from './registry.ts'
import type { WebApp } from './web.ts'

export type AppDeps = {
  actors: Client<Registry>
  /**
   * The same settings the directory actor's Better Auth runs with: its base
   * URL is the tokens' issuer, and the sign-in page offers single sign-on when
   * it's on (read on every request, like the actor does).
   */
  auth: Pick<AuthSettings, 'baseURL' | 'sso' | 'trustedProxies' | 'secret'>
  /** Check every response against its schema (tests turn this on). */
  validateOutput?: boolean
  /** The web app's pages (web.ts); without it, a page's path is not found. */
  web?: WebApp
  /**
   * /health's answer: RivetKit's (registry.routes.health()), which is 503 while
   * the node's connection to the engine is unhealthy, so the load balancer and
   * Docker stop counting on a node cut off from it. Without it, always ok.
   */
  health?: () => Promise<Response>
}

/** The app: a request, and the address it came from (Bun's server.requestIP), which sign-in's rate limits count by. */
export function createApp({
  actors,
  auth,
  validateOutput = false,
  web,
  health = async () => Response.json({ ok: true }),
}: AppDeps): (request: Request, peer?: string) => Promise<Response> {
  const openapi = openApiDocument(operations, { title: 'Ideation Factory', version: '0.0.0' })
  const directory = directoryOf(actors)
  const gateway = authGateway(directory, auth.baseURL, auth.trustedProxies)

  const handlers = createHandlers(actors)
  const onError = (error: unknown, operation: string) => console.error(`${operation} failed:`, error)
  const route = createRouter(operations, handlers, {
    authenticate: (request, operation) => gateway.authenticate(request, operation),
    validateOutput,
    onError,
  })
  const mcp = createMcp({ operations, handlers, gateway, baseURL: auth.baseURL, validateOutput, onError })
  return async (request, peer) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') {
      return health()
    }
    // sign-in, and the documents MCP clients find it by (OAuth server and protected resource metadata)
    if (
      pathname.startsWith('/api/auth/') ||
      pathname === '/.well-known/oauth-authorization-server' ||
      pathname === '/.well-known/openid-configuration' ||
      pathname.startsWith('/.well-known/oauth-protected-resource')
    ) {
      return gateway.forward(request, peer)
    }
    if (pathname === MCP_PATH) {
      return mcp(request)
    }
    if (pathname === '/login') {
      return loginPage(auth.sso ? { name: auth.sso.name, providerId: SSO_PROVIDER_ID } : null)
    }
    if (pathname === '/consent') {
      return consentPage()
    }
    if (pathname === CLI_CODE_PATH) {
      return cliCodePage()
    }
    if (pathname === '/unsubscribe') {
      return unsubscribePage(request, auth, directory)
    }
    if (pathname === `${API_PATH}/openapi.json`) {
      return Response.json(openapi)
    }
    if (pathname === API_PATH || pathname.startsWith(`${API_PATH}/`)) {
      return (
        (await route(request)) ??
        Response.json({ error: { code: 'not_found', message: 'no such route' } }, { status: 404 })
      )
    }
    return web ? web(request) : new Response('Not found.', { status: 404 })
  }
}
