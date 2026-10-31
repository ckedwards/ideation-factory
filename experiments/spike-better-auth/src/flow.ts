// End-to-end checks against a running spike server (./restart.sh adapter|actor),
// over HTTP only, the way a browser, an MCP client and the cli would. Prints
// PASS/FAIL per check and the measures; results go into the spike doc.
//
//   bun src/flow.ts >> out/flow-adapter.txt
import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose'

const BASE = process.env.IDEAF_URL ?? 'http://localhost:25445'
const MCP = `${BASE}/mcp`
const results: { name: string; ok: boolean; detail?: string }[] = []
function check(name: string, ok: boolean, detail?: unknown) {
  const d = detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)
  results.push({ name, ok, detail: d })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? `  — ${d.slice(0, 300)}` : ''}`)
}

class Browser {
  jar = new Map<string, string>()
  constructor(public ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {}
  async req(path: string, init: RequestInit & { json?: unknown; form?: Record<string, string> } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.jar.size) headers.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '))
    headers.set('origin', BASE)
    headers.set('x-forwarded-for', this.ip)
    let body = init.body
    if (init.json !== undefined) ((body = JSON.stringify(init.json)), headers.set('content-type', 'application/json'))
    if (init.form) ((body = new URLSearchParams(init.form).toString()), headers.set('content-type', 'application/x-www-form-urlencoded'))
    const res = await fetch(path.startsWith('http') ? path : BASE + path, { ...init, headers, body: body ?? null, redirect: 'manual' })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair!.indexOf('=')
      const k = pair!.slice(0, i)
      const v = pair!.slice(i + 1)
      if (/max-age=0/i.test(c) || v === '') this.jar.delete(k)
      else this.jar.set(k, v)
    }
    return res
  }
  async json(path: string, init: Parameters<Browser['req']>[1] = {}) {
    const r = await this.req(path, init)
    const t = await r.text()
    let j: any
    try {
      j = JSON.parse(t)
    } catch {
      j = { raw: t }
    }
    return { status: r.status, body: j, headers: r.headers }
  }
}

async function spike(path: string, json?: unknown) {
  const r = await fetch(BASE + path, json === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
  return r.json() as Promise<any>
}
const sql = (query: string, ...args: unknown[]) => spike('/spike/sql', { query, args })
async function lastCode(email: string): Promise<string> {
  const box = (await spike('/spike/outbox')) as { email: string; otp: string }[]
  return box.filter((m) => m.email === email).at(-1)?.otp ?? 'none'
}

async function signIn(b: Browser, email: string, handle?: string) {
  await b.json('/api/auth/email-otp/send-verification-otp', { method: 'POST', json: { email, type: 'sign-in' } })
  const otp = await lastCode(email)
  return b.json('/api/auth/sign-in/email-otp', { method: 'POST', json: { email, otp, ...(handle ? { username: handle } : {}) } })
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

const run = `${Date.now().toString(36)}`
const email = `riley-${run}@example.com`
const handle = `riley-${run}`

// ---------------------------------------------------------------------------
console.log(`# flow against ${BASE} (${(await spike('/health')).mode}) run ${run}\n`)
const t0 = await spike('/spike/stats')

// No passwords
{
  const b = new Browser()
  const up = await b.json('/api/auth/sign-up/email', { method: 'POST', json: { email: `p-${email}`, password: 'password1234', name: 'P' } })
  const inn = await b.json('/api/auth/sign-in/email', { method: 'POST', json: { email: `p-${email}`, password: 'password1234' } })
  check('no passwords: sign-up/email and sign-in/email refused', up.status >= 400 && inn.status >= 400, `${up.status} ${inn.status}`)
}

// Handles
{
  const bad = ['A', 'ab!', '-ab', 'ab-', 'admin', 'x'.repeat(40), 'Riley']
  const outcomes: string[] = []
  for (const h of bad) {
    const b = new Browser()
    const r = await signIn(b, `h-${h.length}-${run}-${Math.random().toString(36).slice(2, 6)}@example.com`, h)
    outcomes.push(`${h.slice(0, 8)}:${r.status}`)
  }
  check('handles: invalid or reserved handles refused at sign-up', outcomes.every((o) => !o.endsWith(':200')), outcomes.join(' '))
  const b = new Browser()
  const r = await signIn(b, `nohandle-${run}@example.com`)
  check('handles: sign-up without a handle refused', r.status >= 400, r.status)
}

// Sign-up by email code, then the directory calls it took
const riley = new Browser()
await spike('/spike/reset-stats')
const s1 = await signIn(riley, email, handle)
const afterSignup = await spike('/spike/stats')
check('email code: sign-up and sign-in', s1.status === 200 && s1.body.user?.username === handle, { status: s1.status, user: s1.body.user?.username })
const userId = s1.body.user?.id as string
await sql(`UPDATE "user" SET name = ? WHERE id = ?`, 'Riley', userId)
{
  const again = new Browser()
  await spike('/spike/reset-stats')
  const s2 = await signIn(again, email)
  const afterSignin = await spike('/spike/stats')
  check('email code: existing user signs in without a handle', s2.status === 200, s2.status)
  console.log(
    `MEASURE directory calls: sign-up ${afterSignup.adapterCalls + afterSignup.directoryCalls.auth} (${afterSignup.adapterLog.join(', ')}); sign-in ${afterSignin.adapterCalls + afterSignin.directoryCalls.auth} (${afterSignin.adapterLog.join(', ')})`,
  )
  const sess = await sql(`SELECT "signInMethod" FROM session WHERE "userId" = ? ORDER BY "createdAt" DESC LIMIT 1`, userId)
  check('session records how it was created', sess[0]?.signInMethod === 'email-otp', sess[0])
}

// The handle and the primary email can't change
{
  const u = await riley.json('/api/auth/update-user', { method: 'POST', json: { username: `other-${run}` } })
  const row = await sql(`SELECT username FROM "user" WHERE id = ?`, userId)
  check('handles: not changeable', row[0]?.username === handle, { status: u.status, body: u.body, now: row[0]?.username })
  const ce = await riley.json('/api/auth/change-email', { method: 'POST', json: { newEmail: `new-${email}` } })
  const ce2 = await riley.json('/api/auth/email-otp/request-email-change', { method: 'POST', json: { newEmail: `new-${email}` } })
  const row2 = await sql(`SELECT email FROM "user" WHERE id = ?`, userId)
  check('primary email: change-email paths off', ce.status >= 400 && ce2.status >= 400 && row2[0]?.email === email, `${ce.status} ${ce2.status}`)
}

// Passkeys only right after an email-code sign-in
{
  const fresh = await riley.json('/api/auth/passkey/generate-register-options')
  check('passkey: registration options allowed right after an email code', fresh.status === 200 && !!fresh.body.challenge, fresh.status)
  await sql(`UPDATE session SET "createdAt" = ? WHERE "userId" = ?`, new Date(Date.now() - 10 * 60_000).toISOString(), userId)
  const old = await riley.json('/api/auth/passkey/generate-register-options')
  const oldVerify = await riley.json('/api/auth/passkey/verify-registration', { method: 'POST', json: { response: {} } })
  check('passkey: refused from an older session', old.status === 403 && oldVerify.status === 403, `${old.status} ${oldVerify.status}`)
  await sql(`UPDATE session SET "createdAt" = ? WHERE "userId" = ?`, new Date().toISOString(), userId)
}

// Session → 15-minute JWT
const JWKS = createRemoteJWKSet(new URL(`${BASE}/api/auth/jwks`))
{
  const r = await riley.json('/api/auth/token')
  const claims = r.body.token ? decodeJwt(r.body.token) : {}
  const v = r.body.token ? await jwtVerify(r.body.token, JWKS, { issuer: BASE, audience: BASE, algorithms: ['EdDSA'] }).catch((e) => e) : null
  check('session JWT: 15 minutes, EdDSA, verifies against /jwks', !!v?.payload && claims.exp! - claims.iat! === 900, { lifetime: claims.exp! - claims.iat!, claims: Object.keys(claims) })
}

// ---------------------------------------------------------------------------
// OAuth: a registered public client (CIMD needs a public HTTPS client ID; see cimd.ts)
const REDIRECT = 'http://127.0.0.1:53682/callback'
const operator = new Browser()
await signIn(operator, 'admin@example.com', 'siteadmin')
const created = (await operator.json('/spike/create-client', { method: 'POST', json: {
  client_name: 'flow test client',
  application_type: 'native',
  redirect_uris: [REDIRECT],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
  response_types: ['code'],
  scope: 'openid profile email offline_access ideas:read ideas:write',
} })).body
const clientId = created.client_id as string
check('oauth: test client registered', !!clientId, created)
const SCOPE = 'openid offline_access ideas:read ideas:write'

async function authorize(b: Browser, over: Record<string, string | null> = {}) {
  const { verifier, challenge } = pkce()
  const params: Record<string, string | null> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: SCOPE,
    state: 'st8',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP,
    prompt: 'consent',
    ...over,
  }
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null) as [string, string][])
  const r = await b.req(`/api/auth/oauth2/authorize?${qs}`)
  return { status: r.status, location: r.headers.get('location'), body: r.status >= 400 ? await r.text() : '', verifier }
}

async function consent(b: Browser, location: string, purpose: { purpose: string; bot?: string }) {
  const q = new URL(location, BASE).searchParams
  const names = new Set(q.getAll('ba_param'))
  const signed = new URLSearchParams()
  for (const [k, v] of q) if (k === 'sig' || k === 'ba_param' || names.has(k)) signed.append(k, v)
  const p = await b.json('/api/auth/ideaf/oauth-purpose', { method: 'POST', json: purpose })
  const c = await b.json('/api/auth/oauth2/consent', { method: 'POST', json: { accept: true, oauth_query: signed.toString() } })
  return { purposeStatus: p.status, ...c }
}

async function token(form: Record<string, string>) {
  const r = await fetch(`${BASE}/api/auth/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })
  return { status: r.status, body: (await r.json()) as any }
}

async function codeFlow(purpose: { purpose: string; bot?: string }) {
  const a = await authorize(riley)
  if (!a.location?.includes('/consent')) return { error: a }
  const c = await consent(riley, a.location, purpose)
  const url = new URL(c.body.url ?? c.body.redirect_uri ?? 'http://x/')
  return { url, verifier: a.verifier, consent: c }
}

let access = ''
let refresh = ''
{
  const f = await codeFlow({ purpose: 'bot-for-me', bot: 'planbot' })
  if ('error' in f) check('oauth: authorize → consent', false, f.error)
  else {
    const code = f.url.searchParams.get('code')
    check('oauth: authorization code returned with iss (RFC 9207)', !!code && f.url.searchParams.get('iss') === BASE, { iss: f.url.searchParams.get('iss'), state: f.url.searchParams.get('state') })
    // missing verifier
    const noVerifier = await token({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, client_id: clientId, resource: MCP })
    check('pkce: token request without a verifier refused', noVerifier.status === 400, noVerifier.body)
    // (a refused attempt may burn the code; get a fresh one)
    const g = await codeFlow({ purpose: 'bot-for-me', bot: 'planbot' })
    if ('error' in g) throw new Error('second flow failed')
    const code2 = g.url.searchParams.get('code')!
    const wrongVerifier = await token({ grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, client_id: clientId, resource: MCP, code_verifier: pkce().verifier })
    check('pkce: wrong verifier refused', wrongVerifier.status === 400, wrongVerifier.body)
    const h = await codeFlow({ purpose: 'bot-for-me', bot: 'planbot' })
    if ('error' in h) throw new Error('third flow failed')
    const code3 = h.url.searchParams.get('code')!
    const wrongRes = await token({ grant_type: 'authorization_code', code: code3, redirect_uri: REDIRECT, client_id: clientId, code_verifier: h.verifier, resource: 'http://localhost:25445/other' })
    check('resource: token request for another resource refused', wrongRes.status === 400, wrongRes.body)
    const k = await codeFlow({ purpose: 'bot-for-me', bot: 'planbot' })
    if ('error' in k) throw new Error('fourth flow failed')
    await spike('/spike/reset-stats')
    const ok = await token({ grant_type: 'authorization_code', code: k.url.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: k.verifier, resource: MCP })
    check('oauth: code + verifier → tokens', ok.status === 200 && !!ok.body.access_token && !!ok.body.refresh_token, { status: ok.status, keys: Object.keys(ok.body) })
    access = ok.body.access_token
    refresh = ok.body.refresh_token
    if (process.env.DEBUG_REFRESH) {
      console.log('DEBUG token-exchange adapter log', (await spike('/spike/stats')).adapterLog.join(', '))
      console.log('DEBUG refresh rows', JSON.stringify(await sql(`SELECT id, token, "sessionId", revoked FROM "oauthRefreshToken"`)))
      console.log('DEBUG refresh token from client', refresh, 'sha256 b64url', createHash('sha256').update(refresh).digest('base64url'))
    }
    const claims = decodeJwt(access)
    check('access token: JWT, 15 minutes, audience is the MCP resource', claims.exp! - claims.iat! === 900 && (claims.aud === MCP || (Array.isArray(claims.aud) && claims.aud.includes(MCP))), { aud: claims.aud, lifetime: claims.exp! - claims.iat! })
    check('access token: carries purpose and bot from the consent screen', claims.purpose === 'bot-for-me' && claims.bot === 'planbot', { purpose: claims.purpose, bot: claims.bot, name: claims.name })
    // code reuse, on a grant of its own: reuse also revokes what that code issued
    const r = await codeFlow({ purpose: 'me' })
    if ('error' in r) throw new Error('reuse flow failed')
    const rc = r.url.searchParams.get('code')!
    const first = await token({ grant_type: 'authorization_code', code: rc, redirect_uri: REDIRECT, client_id: clientId, code_verifier: r.verifier, resource: MCP })
    const reuse = await token({ grant_type: 'authorization_code', code: rc, redirect_uri: REDIRECT, client_id: clientId, code_verifier: r.verifier, resource: MCP })
    const afterReuse = await token({ grant_type: 'refresh_token', refresh_token: first.body.refresh_token, client_id: clientId, resource: MCP })
    check('oauth: authorization code is single use, and reuse revokes its tokens', first.status === 200 && reuse.status === 400 && afterReuse.status === 400, { reuse: reuse.body, refreshAfterReuse: afterReuse.status })
  }
  const wrongRedirect = await authorize(riley, { redirect_uri: 'http://127.0.0.1:53682/other' })
  check('redirect: wrong redirect URI refused (no redirect to it)', !(wrongRedirect.location ?? '').startsWith('http://127.0.0.1:53682/other'), { status: wrongRedirect.status, location: wrongRedirect.location?.slice(0, 120) })
  const noPkce = await authorize(riley, { code_challenge: null, code_challenge_method: null })
  check('pkce: authorize without a challenge refused', !(noPkce.location ?? '').includes('/consent') && !(noPkce.location ?? '').includes('code='), { status: noPkce.status, location: noPkce.location?.slice(0, 160) })
  const plain = await authorize(riley, { code_challenge_method: 'plain', code_challenge: 'x'.repeat(43) })
  check('pkce: plain method refused (S256 only)', !(plain.location ?? '').includes('/consent') && !(plain.location ?? '').includes('code='), { status: plain.status, location: plain.location?.slice(0, 160) })
  const otherRes = await authorize(riley, { resource: 'https://evil.example/mcp' })
  check('resource: authorize for an unknown resource refused', !(otherRes.location ?? '').includes('/consent') && !(otherRes.location ?? '').includes('code='), { status: otherRes.status, location: otherRes.location?.slice(0, 160) })
}

// ---------------------------------------------------------------------------
// MCP with the access token: zero directory calls to authenticate
async function mcp(tok: string, method: string, params: unknown = {}, id = 1) {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const t = await r.text()
  return { status: r.status, body: t.startsWith('{') ? JSON.parse(t) : t, www: r.headers.get('www-authenticate') }
}
{
  await mcp(access, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'flow', version: '0' } })
  await mcp(access, 'tools/list') // warms the JWKS cache
  await spike('/spike/reset-stats')
  const before = await spike('/spike/stats')
  const N = 200
  const t = performance.now()
  let okCount = 0
  for (let i = 0; i < N; i++) if ((await mcp(access, 'tools/call', { name: 'list_ideas', arguments: {} }, i + 2)).status === 200) okCount++
  const ms = (performance.now() - t) / N
  const after = await spike('/spike/stats')
  const dirCalls = after.adapterCalls + after.directoryCalls.auth + after.directoryCalls.status - (before.adapterCalls + before.directoryCalls.auth + before.directoryCalls.status)
  check(`mcp: ${N} read calls made zero directory calls`, okCount === N && dirCalls === 0, { okCount, dirCalls, msPerRequest: ms.toFixed(2) })
  const c = await mcp(access, 'tools/call', { name: 'add_comment', arguments: { idea: 'idea-1', text: 'hello' } }, 999)
  const text = c.body?.result?.content?.[0]?.text ?? ''
  check('mcp: action labeled from the token alone', text.startsWith('🤖 planbot on behalf of Riley'), text)
  const bad = await mcp(access.slice(0, -4) + 'AAAA', 'tools/list')
  check('mcp: tampered token refused with a 401 challenge', bad.status === 401 && !!bad.www?.includes('resource_metadata'), { status: bad.status, www: bad.www })
}

// Signature check time, in process
if (access) {
  const { importJWK } = await import('jose')
  const jwks = (await (await fetch(`${BASE}/api/auth/jwks`)).json()) as { keys: any[] }
  const kid = (JSON.parse(Buffer.from(access.split('.')[0]!, 'base64url').toString()) as { kid: string }).kid
  const key = await importJWK(jwks.keys.find((k) => k.kid === kid), 'EdDSA')
  const N = 2000
  const t = performance.now()
  for (let i = 0; i < N; i++) await jwtVerify(access, key, { issuer: BASE, audience: MCP, algorithms: ['EdDSA'] })
  console.log(`MEASURE signature verification: ${(((performance.now() - t) / N) * 1000).toFixed(1)} µs per token (jose, Ed25519, Bun)`)
}

// ---------------------------------------------------------------------------
// Refresh: rotation, and reuse of an old refresh token
{
  await spike('/spike/reset-stats')
  const r1 = await token({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, resource: MCP })
  const st = await spike('/spike/stats')
  check('refresh: rotates (new refresh token)', r1.status === 200 && !!r1.body.refresh_token && r1.body.refresh_token !== refresh, { status: r1.status, body: r1.body })
  console.log(`MEASURE directory calls per refresh: ${st.adapterCalls + st.directoryCalls.auth} (${st.adapterLog.join(', ')})`)
  const c1 = decodeJwt(r1.body.access_token ?? access)
  check('refresh: new access token keeps purpose and bot', c1.purpose === 'bot-for-me' && c1.bot === 'planbot', { purpose: c1.purpose, bot: c1.bot })
  const quick = await token({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, resource: MCP })
  console.log(`NOTE reuse within mcp()'s 30 s refreshTokenReuseInterval: ${quick.status} ${quick.body.error ?? 'replayed same response'}`)
  console.log('… waiting 31 s to pass the reuse interval')
  await Bun.sleep(Number(process.env.REUSE_WAIT_MS ?? 31_000))
  const reuse = await token({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, resource: MCP })
  check('refresh: reusing an old refresh token is refused', reuse.status === 400, reuse.body)
  const newer = await token({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: clientId, resource: MCP })
  check('refresh: reuse revokes the grant (newer refresh token also dead)', newer.status === 400, { status: newer.status, body: newer.body })
  if (newer.status === 200) refresh = newer.body.refresh_token
}

// ---------------------------------------------------------------------------
// Personal tokens and the cli exchange
let personal = ''
{
  const tooLong = await riley.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'personal', name: 'planbot', expiresIn: 2 * 365 * 86400, metadata: { purpose: 'bot-for-me', bot: 'planbot' } } })
  check('personal token: more than a year refused', tooLong.status >= 400, tooLong.status)
  const adminMeta = await riley.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'personal', name: 'x', metadata: { site_admin: true } } })
  check('personal token: cannot claim site admin', adminMeta.status >= 400, adminMeta.status)
  const noName = await riley.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'personal', metadata: { purpose: 'me' } } })
  check('personal token: needs a name', noName.status >= 400, noName.status)
  const k = await riley.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'personal', name: 'planbot', expiresIn: 365 * 86400, metadata: { purpose: 'bot-for-me', bot: 'planbot' } } })
  personal = k.body.key
  check('personal token: created, shown once', k.status === 200 && typeof personal === 'string', { status: k.status, start: k.body.start })
  const stored = await sql(`SELECT key, "expiresAt" FROM apikey WHERE id = ?`, k.body.id)
  check('personal token: stored hashed', !!stored[0] && stored[0].key !== personal && !String(stored[0].key).includes(personal), String(stored[0]?.key).slice(0, 12))
  const list = await riley.json('/api/auth/api-key/list')
  check('personal token: listing never shows it again', !JSON.stringify(list.body).includes(personal), list.status)
  await spike('/spike/reset-stats')
  const ex = await (await fetch(`${BASE}/ideaf/token`, { method: 'POST', body: JSON.stringify({ token: personal }) })).json() as any
  const exStats = await spike('/spike/stats')
  const v = ex.access_token ? await jwtVerify(ex.access_token, JWKS, { issuer: BASE, audience: BASE, algorithms: ['EdDSA'] }).catch((e) => e) : null
  check('exchange: personal token → 15-minute JWT that verifies by signature', !!v?.payload && v.payload.exp - v.payload.iat === 900 && v.payload.bot === 'planbot', v?.payload ?? ex)
  console.log(`MEASURE directory calls per exchange: ${exStats.adapterCalls + exStats.directoryCalls.auth + exStats.directoryCalls.status} (${exStats.adapterLog.join(', ')})`)
  const after = await sql(`SELECT "requestCount", "lastRequest" FROM apikey WHERE id = ?`, k.body.id)
  console.log(`NOTE api key row after an exchange: ${JSON.stringify(after[0])}`)
  // Site admin tokens
  const notAdmin = await riley.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'admin', name: 'ops', metadata: { reason: 'rotate keys' } } })
  check('site admin token: refused for a non-admin', notAdmin.status === 403, notAdmin.status)
  const admin = operator
  const noReason = await admin.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'admin', name: 'ops' } })
  const tooLongAdmin = await admin.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'admin', name: 'ops', expiresIn: 31 * 86400, metadata: { reason: 'quarterly audit' } } })
  const okAdmin = await admin.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'admin', name: 'ops', expiresIn: 30 * 86400, metadata: { reason: 'quarterly audit' } } })
  const adminEx = (await (await fetch(`${BASE}/ideaf/token`, { method: 'POST', body: JSON.stringify({ token: okAdmin.body.key }) })).json()) as any
  const audit = (await spike('/spike/stats')).adminAudit
  check(
    'site admin token: needs a reason, at most 30 days, use logged',
    noReason.status === 400 && tooLongAdmin.status >= 400 && okAdmin.status === 200 && !!adminEx.access_token && audit.some((a: any) => a.reason === 'quarterly audit'),
    `${noReason.status} ${tooLongAdmin.status} ${okAdmin.status} audit=${audit.length}`,
  )
}

// ---------------------------------------------------------------------------
// Revocation and inactive users
{
  // revoke a personal token
  const keys = (await riley.json('/api/auth/api-key/list')).body
  const list = (Array.isArray(keys) ? keys : keys.apiKeys) as { id: string; name: string }[]
  const id = list.find((k) => k.name === 'planbot')!.id
  const del = await riley.json('/api/auth/api-key/delete', { method: 'POST', json: { keyId: id, configId: 'personal' } })
  const ex = await fetch(`${BASE}/ideaf/token`, { method: 'POST', body: JSON.stringify({ token: personal }) })
  check('revocation: a revoked personal token gets no new JWT', del.status === 200 && ex.status === 401, { del: del.status, delBody: del.body, exchange: ex.status })

  // sign out a session
  const b = new Browser()
  await signIn(b, email)
  const before = await b.json('/api/auth/token')
  await b.json('/api/auth/sign-out', { method: 'POST', json: {} })
  const after = await b.json('/api/auth/token')
  check('revocation: a signed-out session gets no new JWT', before.status === 200 && after.status === 401, `${before.status} ${after.status}`)

  // a fresh grant to test inactive users with
  const f = await codeFlow({ purpose: 'me' })
  if ('error' in f) throw new Error('flow failed')
  const t = await token({ grant_type: 'authorization_code', code: f.url.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: f.verifier, resource: MCP })
  const k2 = await riley.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'personal', name: 'cli', metadata: { purpose: 'me' } } })
  await spike('/spike/inactive', { id: userId, inactive: true })
  const ref = await token({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: clientId, resource: MCP })
  const ex2 = await fetch(`${BASE}/ideaf/token`, { method: 'POST', body: JSON.stringify({ token: k2.body.key }) })
  const sess = await riley.json('/api/auth/token')
  const signin = await signIn(new Browser(), email)
  check('inactive: no new tokens (refresh, exchange, session JWT, sign-in)', ref.status >= 400 && ex2.status === 401 && sess.status >= 400 && signin.status >= 400, `${ref.status} ${ex2.status} ${sess.status} ${signin.status}`)
  const read = await mcp(t.body.access_token, 'tools/call', { name: 'list_ideas', arguments: {} })
  const write = await mcp(t.body.access_token, 'tools/call', { name: 'add_comment', arguments: { idea: 'idea-1', text: 'still here?' } })
  check('inactive: an issued JWT still reads until it expires', read.status === 200 && !read.body?.result?.isError, read.status)
  check('inactive: writes refused at once', write.body?.result?.isError === true, write.body?.result?.content?.[0]?.text)
  await spike('/spike/inactive', { id: userId, inactive: false })
}

// ---------------------------------------------------------------------------
// The cli: device authorization (RFC 8628) through the OAuth provider
{
  const b = new Browser()
  await signIn(b, email)
  const dc = await (await fetch(`${BASE}/api/auth/device/code`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, scope: SCOPE, resource: MCP }) })).json() as any
  // the verification page claims the code for the signed-in session, then approves
  const claim = dc.user_code ? await b.json(`/api/auth/device?user_code=${dc.user_code}`) : { status: 0 }
  const approve = dc.user_code ? await b.json('/api/auth/device/approve', { method: 'POST', json: { userCode: dc.user_code } }) : { status: 0, body: null }
  const t = await token({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code ?? '', client_id: clientId, resource: MCP })
  const claims = t.body.access_token ? decodeJwt(t.body.access_token) : {}
  check('cli: device flow → JWT access token + refresh token', t.status === 200 && !!t.body.refresh_token && claims.exp! - claims.iat! === 900, { code: dc.verification_uri_complete ?? dc, claim: claim.status, approve: approve.status, approveBody: approve.body, token: t.status, tokenBody: t.body })
}

// ---------------------------------------------------------------------------
// Rate limiting
{
  const statuses: number[] = []
  const flood = new Browser('10.200.0.1')
  for (let i = 0; i < 12; i++) statuses.push((await flood.json('/api/auth/email-otp/send-verification-otp', { method: 'POST', json: { email: `flood-${run}@example.com`, type: 'sign-in' } })).status)
  check('rate limit: email codes limited per IP and path', statuses.includes(429), statuses.join(' '))
  const tables = (await sql(`SELECT name FROM sqlite_master WHERE type='table'`)).map((r: any) => r.name)
  check('rate limit: counters not in the directory (no rateLimit table)', !tables.includes('rateLimit'), tables.join(' '))
}

const final = await spike('/spike/stats')
console.log(`\nMEASURE totals since start: adapter calls ${final.adapterCalls - t0.adapterCalls}, actor statements ${JSON.stringify(final.actor.statements ?? final.actor)}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) console.log(`failed: ${failed.map((f) => f.name).join('; ')}`)
