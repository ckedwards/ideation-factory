// The spike's app node: Better Auth (or a forwarder to it), the login and
// consent pages, the personal-token exchange, and a stub MCP server protected
// by 15-minute JWTs.
//
//   bun scripts/worktree.ts exec -- bun experiments/spike-better-auth/src/server.ts
//   SPIKE_STORAGE=adapter (default)  approach 1: custom adapter → directoryA actions
//   SPIKE_STORAGE=actor              approach 2: Better Auth inside directoryB
import { createMcpProtectedRequestHandler } from '@better-auth/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { setup } from 'rivetkit'
import { createClient } from 'rivetkit/client'
import * as z from 'zod'
import { ACCESS_TOKEN_SECONDS, BASE, cimdFetches, MCP_RESOURCE, makeAuth, outbox } from './auth.ts'
import { directoryA, directoryB } from './directory.ts'
import { consentPage, devicePage, loginPage } from './pages.ts'
import { calls, directoryAdapter } from './remote-adapter.ts'

const MODE = (process.env.SPIKE_STORAGE ?? 'adapter') as 'adapter' | 'actor'
const port = Number(process.env.PORT ?? 25445)

export const registry = setup({ use: { directoryA, directoryB } })
await registry.startAndWait()
const { endpoint } = registry.parseConfig()
const client = createClient<typeof registry>(endpoint!)
const dirA = client.directoryA.getOrCreate(['main'])
const dirB = client.directoryB.getOrCreate(['main'])

/** Directory calls made by this app node, by kind (for the measures). */
export const directoryCalls = { auth: 0, status: 0 }

// --- Better Auth, wherever it runs --------------------------------------
const localAuth = MODE === 'adapter' ? makeAuth(directoryAdapter((op) => dirA.store(op)) as never) : null

async function authFetch(req: Request): Promise<Response> {
  if (localAuth) return localAuth.handler(req)
  directoryCalls.auth++
  const headers = new Headers(req.headers)
  headers.set('x-ideaf-url', req.url)
  const u = new URL(req.url)
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()
  const res = await dirB.fetch(u.pathname + u.search, { method: req.method, headers, ...(body ? { body } : {}), redirect: 'manual' } as never)
  return res
}

/** A server-side auth.api call. */
async function authApi<T>(method: string, body: unknown, headers?: Headers): Promise<T> {
  if (localAuth) return (localAuth.api as Record<string, (a: unknown) => Promise<T>>)[method]!({ body, headers: headers ?? new Headers() })
  directoryCalls.auth++
  const res = await dirB.fetch('/ideaf/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ideaf-url': `${BASE}/ideaf/api` },
    body: JSON.stringify({ method, body, headers: headers ? Object.fromEntries(headers) : {} }),
  })
  const out = (await res.json()) as { ok: boolean; value?: T; error?: string; status?: number }
  if (!out.ok) throw Object.assign(new Error(out.error), { statusCode: out.status })
  return out.value as T
}

async function userStatus(id: string) {
  directoryCalls.status++
  return MODE === 'adapter' ? dirA.userStatus(id) : dirB.userStatus(id)
}

// --- The personal-token exchange (cli) ----------------------------------
/** Site admin token uses, logged (stand-in for an audit log). */
export const adminAudit: { at: number; keyId: string; reason: string }[] = []

async function exchange(req: Request): Promise<Response> {
  const { token } = (await req.json()) as { token: string }
  type Verified = { valid: boolean; key: { id: string; referenceId: string; configId: string; metadata: Record<string, string> | null } | null }
  let key: Verified['key'] = null
  for (const configId of ['personal', 'admin']) {
    const v = await authApi<Verified>('verifyApiKey', { key: token, configId }).catch(() => null)
    if (v?.valid && v.key) {
      key = v.key
      break
    }
  }
  if (!key) return Response.json({ error: 'invalid_token' }, { status: 401 })
  const status = await userStatus(key.referenceId)
  if (!status.exists || status.inactive) return Response.json({ error: 'inactive' }, { status: 401 })
  const meta = key.metadata ?? {}
  if (key.configId === 'admin') adminAudit.push({ at: Date.now(), keyId: key.id, reason: meta.reason ?? '' })
  const now = Math.floor(Date.now() / 1000)
  const { token: jwt } = await authApi<{ token: string }>('signJWT', {
    payload: {
      sub: key.referenceId,
      purpose: meta.purpose ?? 'me',
      ...(meta.bot ? { bot: meta.bot } : {}),
      tid: key.id,
      ...(key.configId === 'admin' ? { site_admin: true } : {}),
      iss: BASE,
      aud: BASE,
      iat: now,
      exp: now + ACCESS_TOKEN_SECONDS,
    },
  })
  return Response.json({ access_token: jwt, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS })
}

// --- The stub MCP server -------------------------------------------------
export const mcpLog: string[] = []
function label(claims: Record<string, unknown>): string {
  const who = String(claims.name ?? claims.handle ?? claims.sub)
  if (claims.purpose === 'bot-for-me') return `🤖 ${claims.bot} on behalf of ${who}`
  if (claims.purpose === 'bot') return `🤖 ${claims.bot}`
  return who
}

function mcpServer(claims: Record<string, unknown>): McpServer {
  const server = new McpServer({ name: 'ideaf-spike', version: '0.0.0' })
  server.registerTool('list_ideas', { description: 'List ideas (stub)', inputSchema: {} }, async () => {
    mcpLog.push(`list_ideas by ${label(claims)}`)
    return { content: [{ type: 'text', text: JSON.stringify([{ id: 'idea-1', title: 'A stub idea' }]) }] }
  })
  server.registerTool('add_comment', { description: 'Comment on an idea (stub)', inputSchema: { idea: z.string(), text: z.string() } }, async ({ idea, text }) => {
    // Writes check the caller's current status: one directory read, writes only.
    const status = await userStatus(String(claims.sub))
    if (!status.exists || status.inactive) return { isError: true, content: [{ type: 'text', text: 'your account is inactive' }] }
    const line = `${label(claims)} commented on ${idea}: ${text}`
    mcpLog.push(line)
    return { content: [{ type: 'text', text: line }] }
  })
  return server
}

const mcpHandler = createMcpProtectedRequestHandler(
  { issuer: BASE, audience: MCP_RESOURCE, jwksUrl: `${BASE}/api/auth/jwks`, jwtVerifyOptions: { algorithms: ['EdDSA'] } },
  async (request, claims) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await mcpServer(claims as Record<string, unknown>).connect(transport)
    return transport.handleRequest(request)
  },
)

// --- Routing ---------------------------------------------------------------
async function fetch(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const p = url.pathname
  if (p.startsWith('/api/auth/') || p.startsWith('/.well-known/')) return authFetch(req)
  if (p === '/mcp') return mcpHandler(req)
  if (p === '/login') return html(loginPage())
  if (p === '/consent') return html(consentPage())
  if (p === '/device') return html(devicePage())
  if (p === '/ideaf/token' && req.method === 'POST') return exchange(req)
  // spike-only introspection, for the test scripts
  if (p === '/spike/outbox') return Response.json(localAuth ? outbox : await (await dirB.fetch('/ideaf/outbox', { headers: { 'x-ideaf-url': `${BASE}/ideaf/outbox` } })).json())
  if (p === '/spike/stats')
    return Response.json({ mode: MODE, directoryCalls, adapterCalls: calls.count, adapterLog: calls.log.slice(-200), mcpLog, adminAudit, cimdFetches: localAuth ? cimdFetches : null, actor: MODE === 'adapter' ? await dirA.stats() : await dirB.stats() })
  if (p === '/spike/reset-stats') {
    directoryCalls.auth = directoryCalls.status = 0
    calls.count = 0
    calls.log.length = 0
    return Response.json({ ok: true })
  }
  if (p === '/spike/inactive' && req.method === 'POST') {
    const { id, inactive } = (await req.json()) as { id: string; inactive: boolean }
    await (MODE === 'adapter' ? dirA.setInactive(id, inactive) : dirB.setInactive(id, inactive))
    return Response.json({ ok: true })
  }
  if (p === '/spike/sql' && req.method === 'POST') {
    const { query, args } = (await req.json()) as { query: string; args?: unknown[] }
    return Response.json(await (MODE === 'adapter' ? dirA.sql(query, ...(args ?? [])) : dirB.sql(query, ...(args ?? []))))
  }
  if (p === '/spike/create-client' && req.method === 'POST') {
    try {
      return Response.json(await authApi('adminCreateOAuthClient', await req.json(), req.headers))
    } catch (e) {
      console.error('create-client failed', e)
      return Response.json({ error: String((e as Error).message), body: (e as { body?: unknown }).body }, { status: 400 })
    }
  }
  if (p === '/health') return Response.json({ ok: true, mode: MODE })
  return new Response('not found', { status: 404 })
}

function html(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const server = Bun.serve({ port, fetch, idleTimeout: 60 })
console.log(`spike-better-auth on ${BASE} (port ${server.port}, storage: ${MODE})`)
