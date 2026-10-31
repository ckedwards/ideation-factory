// CIMD through the authorization server, with real clients' published
// metadata documents (Claude Code, Claude.ai, VS Code). Run against the
// adapter-mode server (the fetch counter lives in the app node):
//
//   ./restart.sh adapter && bun src/cimd-flow.ts >> out/cimd-flow.txt
//   CIMD_ALLOW=vscode.dev ./restart.sh adapter && ALLOWLIST=vscode.dev bun src/cimd-flow.ts
import { createHash, randomBytes } from 'node:crypto'
import { decodeJwt } from 'jose'

const BASE = 'http://localhost:25445'
const MCP = `${BASE}/mcp`
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'
const CLAUDE_AI = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const VSCODE = 'https://vscode.dev/oauth/client-metadata.json'
const results: [string, boolean][] = []
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push([name, ok])
  const d = detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? `  — ${d.slice(0, 300)}` : ''}`)
}
let ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const jar = new Map<string, string>()
async function req(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers)
  headers.set('origin', BASE)
  headers.set('x-forwarded-for', ip)
  if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
  let body = init.body
  if (init.json !== undefined) ((body = JSON.stringify(init.json)), headers.set('content-type', 'application/json'))
  const r = await fetch(path.startsWith('http') ? path : BASE + path, { ...init, headers, body: body ?? null, redirect: 'manual' })
  for (const c of r.headers.getSetCookie()) {
    const [pair] = c.split(';')
    const i = pair!.indexOf('=')
    jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  return r
}
const spike = async (p: string, json?: unknown) => (await fetch(BASE + p, json === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })).json() as Promise<any>
const fetches = async () => ((await spike('/spike/stats')).cimdFetches as { url: string; outcome: string }[])

// sign in
const run = Date.now().toString(36)
await req('/api/auth/email-otp/send-verification-otp', { method: 'POST', json: { email: `cimd-${run}@example.com`, type: 'sign-in' } })
const otp = ((await spike('/spike/outbox')) as any[]).filter((m) => m.email === `cimd-${run}@example.com`).at(-1).otp
await req('/api/auth/sign-in/email-otp', { method: 'POST', json: { email: `cimd-${run}@example.com`, otp, username: `cimd-${run}` } })

function authorizeUrl(clientId: string, redirect: string, challenge: string) {
  return `/api/auth/oauth2/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'openid offline_access ideas:read', state: 's',
    code_challenge: challenge, code_challenge_method: 'S256', resource: MCP, prompt: 'consent',
  })}`
}
async function authorize(clientId: string, redirect: string) {
  const verifier = randomBytes(32).toString('base64url')
  const r = await req(authorizeUrl(clientId, redirect, createHash('sha256').update(verifier).digest('base64url')))
  return { status: r.status, location: r.headers.get('location') ?? '', verifier, text: r.status >= 400 ? await r.text() : '' }
}

if (process.env.ALLOWLIST) {
  // Host allowlist mode: the server runs with CIMD_ALLOW set
  const listed = await authorize(VSCODE, 'http://127.0.0.1:33418/')
  const unlisted = await authorize(CLAUDE_CODE, 'http://localhost:43123/callback')
  const f = await fetches()
  check(`allowlist (${process.env.ALLOWLIST}): listed host accepted`, listed.location.includes('/consent'), listed.location.slice(0, 160))
  check('allowlist: unlisted host refused before any fetch', !unlisted.location.includes('/consent') && !f.some((x) => x.url === CLAUDE_CODE), { location: unlisted.location.slice(0, 160), fetched: f.map((x) => x.url) })
} else {
  // 1. Claude Code's CIMD document; loopback redirect on an ephemeral port
  const before = (await fetches()).length
  const a = await authorize(CLAUDE_CODE, 'http://localhost:43123/callback')
  const afterFirst = await fetches()
  check('cimd: Claude Code client resolved from its metadata document', a.location.includes('/consent'), a.location.slice(0, 200) || a.text.slice(0, 200))
  console.log(`NOTE fetches for the first authorize: ${afterFirst.length - before} (${afterFirst.slice(before).map((f) => `${f.url} ${f.outcome}`).join(', ')})`)
  const row = await spike('/spike/sql', { query: `SELECT "clientId", "clientDiscoveryId", "redirectUris", "tokenEndpointAuthMethod" FROM "oauthClient" WHERE "clientId" = ?`, args: [CLAUDE_CODE] })
  console.log(`NOTE stored client row: ${JSON.stringify(row[0])}`)

  // finish the flow as Claude Code would
  if (a.location.includes('/consent')) {
    const q = new URL(a.location, BASE).searchParams
    const names = new Set(q.getAll('ba_param'))
    const signed = new URLSearchParams()
    for (const [k, v] of q) if (k === 'sig' || k === 'ba_param' || names.has(k)) signed.append(k, v)
    await req('/api/auth/ideaf/oauth-purpose', { method: 'POST', json: { purpose: 'me' } })
    const c = (await (await req('/api/auth/oauth2/consent', { method: 'POST', json: { accept: true, oauth_query: signed.toString() } })).json()) as any
    const code = new URL(c.url).searchParams.get('code')!
    const t = await fetch(`${BASE}/api/auth/oauth2/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:43123/callback', client_id: CLAUDE_CODE, code_verifier: a.verifier, resource: MCP }),
    })
    const tok = (await t.json()) as any
    const claims = tok.access_token ? decodeJwt(tok.access_token) : {}
    check('cimd: Claude Code client gets a 15-minute JWT for the MCP resource', t.status === 200 && claims.exp! - claims.iat! === 900, { status: t.status, aud: claims.aud, azp: claims.azp })
  }

  // 2. Repeat sign-ins don't refetch while the cached document is fresh
  const n0 = (await fetches()).length
  for (let i = 0; i < 5; i++) await authorize(CLAUDE_CODE, 'http://localhost:43123/callback')
  const n1 = (await fetches()).length
  check('cimd cache: 5 repeat authorizations, no refetch', n1 === n0, `${n1 - n0} fetches`)

  // 3. Other real clients
  const ai = await authorize(CLAUDE_AI, 'https://claude.ai/api/mcp/auth_callback')
  check('cimd: Claude.ai connector client resolved', ai.location.includes('/consent'), ai.location.slice(0, 200))
  const vs = await authorize(VSCODE, 'http://127.0.0.1:33418/')
  check('cimd: VS Code client resolved', vs.location.includes('/consent'), vs.location.slice(0, 200))
  const badRedirect = await authorize(CLAUDE_CODE, 'https://evil.example/callback')
  check('cimd: redirect URI not in the document refused', !badRedirect.location.startsWith('https://evil.example'), badRedirect.location.slice(0, 200))

  // 4. A client ID whose host resolves to a private address
  const priv = await authorize('https://127.0.0.1.sslip.io/client.json', 'http://localhost:1/cb')
  const pf = await fetches()
  check('cimd: client ID resolving to a private address refused', !priv.location.includes('/consent'), { location: priv.location.slice(0, 160), fetch: pf.at(-1) })
  const lit = await authorize('https://169.254.169.254/latest/meta-data', 'http://localhost:1/cb')
  check('cimd: client ID on a link-local literal refused', !lit.location.includes('/consent'), lit.location.slice(0, 160))

  // 5. A flood of distinct client IDs on one origin: fetches are capped
  const m0 = (await fetches()).length
  const statuses: Record<string, number> = {}
  const t0 = performance.now()
  for (let i = 0; i < 60; i++) {
    ip = `10.8.${Math.floor(i / 250)}.${i % 250}` // a new IP each time: past the per-IP authorize limit, to reach CIMD's own budget
    const r = await authorize(`https://example.com/cimd-${run}-${i}.json`, 'http://localhost:1/cb')
    const k = r.location.includes('/consent') ? 'consent' : (new URL(r.location || 'http://x/?error=none', BASE).searchParams.get('error_description') ?? String(r.status)).slice(0, 60)
    statuses[k] = (statuses[k] ?? 0) + 1
  }
  const m1 = (await fetches()).length
  check('cimd flood: 60 new client IDs on one origin, from 60 IPs, cause at most 30 fetches', m1 - m0 <= 30, { fetches: m1 - m0, outcomes: statuses, ms: Math.round(performance.now() - t0) })
}

const failed = results.filter((r) => !r[1])
console.log(`\n${results.length - failed.length}/${results.length} passed`)
