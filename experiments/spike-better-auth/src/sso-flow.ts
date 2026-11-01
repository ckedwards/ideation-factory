// Single sign-on checks: OIDC and SAML against a real identity provider
// (Keycloak in a container, see kc-setup.ts), SCIM deprovisioning, and the
// switch of an existing deployment from email codes to single sign-on.
// Restarts the spike server itself (approach 2: Better Auth in the actor):
//
//   bun src/sso-flow.ts >> out/sso-flow.txt
import { createHash, randomBytes } from 'node:crypto'
import { decodeJwt } from 'jose'
import { KC_REALM, KC_URL, OIDC_PROVIDER, SAML_PROVIDER, SCIM_TOKEN } from './auth.ts'
import { PASSWORD, people, SAML_SP_ENTITY, setupRealm, spKeys } from './kc-setup.ts'

const BASE = 'http://localhost:25445'
const MCP = `${BASE}/mcp`
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'
const results: [string, boolean][] = []
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push([name, ok])
  const d = detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? `  — ${d.slice(0, 400)}` : ''}`)
}
const note = (s: string) => console.log(`NOTE  ${s}`)

/** A browser: cookies per host, no automatic redirects. */
class Browser {
  jars = new Map<string, Map<string, string>>()
  ip = `10.11.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  async req(url: string, init: RequestInit & { json?: unknown; form?: Record<string, string>; noCookies?: boolean; origin?: string } = {}) {
    const u = new URL(url, BASE)
    const jar = this.jars.get(u.host) ?? new Map<string, string>()
    this.jars.set(u.host, jar)
    const headers = new Headers(init.headers)
    if (jar.size && !init.noCookies) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
    if (u.host === new URL(BASE).host) {
      headers.set('x-forwarded-for', this.ip)
      if (init.method && init.method !== 'GET') headers.set('origin', init.origin ?? BASE)
    }
    let body = init.body
    if (init.json !== undefined) ((body = JSON.stringify(init.json)), headers.set('content-type', 'application/json'))
    if (init.form) ((body = new URLSearchParams(init.form).toString()), headers.set('content-type', 'application/x-www-form-urlencoded'))
    const r = await fetch(u, { ...init, headers, body: body ?? null, redirect: 'manual' })
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair!.indexOf('=')
      const [k, v] = [pair!.slice(0, i), pair!.slice(i + 1)]
      if (/max-age=0/i.test(c) || v === '') jar.delete(k)
      else jar.set(k, v)
    }
    return r
  }
  async json(url: string, init: Parameters<Browser['req']>[1] = {}) {
    const r = await this.req(url, init)
    const t = await r.text()
    let body: any
    try {
      body = JSON.parse(t)
    } catch {
      body = { raw: t }
    }
    return { status: r.status, body, location: r.headers.get('location') ?? '' }
  }
  /** Follow redirects (GET), stopping when one leaves for `stopAt` or a page loads. */
  async follow(url: string, stopAt?: (u: URL) => boolean) {
    let r = await this.req(url)
    let at = new URL(url, BASE)
    for (let i = 0; i < 10 && r.status >= 300 && r.status < 400; i++) {
      at = new URL(r.headers.get('location')!, at)
      if (stopAt?.(at)) return { r, at, stopped: true }
      r = await this.req(at.toString())
    }
    return { r, at, stopped: false }
  }
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x2F;/gi, '/').replace(/&#x3D;/gi, '=')
const formAction = (html: string, id?: string) => {
  const m = id ? html.match(new RegExp(`<form[^>]*id="${id}"[^>]*>`)) : html.match(/<form[^>]*>/)
  const a = m?.[0].match(/action="([^"]+)"/)?.[1]
  return a ? decode(a) : null
}
const hidden = (html: string, name: string) => {
  const m = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))
  const v = m?.[0].match(/value="([^"]*)"/)?.[1]
  return v === undefined ? null : decode(v)
}

/** Sign in at Keycloak's own login form, as a person would. */
async function kcLogin(b: Browser, kcUrl: string, username: string) {
  const page = await b.req(kcUrl)
  const html = await page.text()
  const action = formAction(html, 'kc-form-login')
  if (!action) throw new Error(`no Keycloak login form (status ${page.status}): ${html.slice(0, 200)}`)
  return b.req(action, { method: 'POST', form: { username, password: PASSWORD, credentialId: '' } })
}

/** The whole OIDC sign-in: our /sign-in/sso → Keycloak → our callback → callbackURL. */
async function oidcSignIn(b: Browser, username: string, callbackURL = '/welcome') {
  const start = await b.json('/api/auth/sign-in/sso', { method: 'POST', json: { providerId: OIDC_PROVIDER, callbackURL, errorCallbackURL: '/sso-error' } })
  if (!start.body.url) return { ok: false, error: `sign-in/sso ${start.status}: ${JSON.stringify(start.body).slice(0, 200)}`, landed: '' }
  const afterLogin = await kcLogin(b, start.body.url, username)
  const cb = afterLogin.headers.get('location')
  if (!cb) return { ok: false, error: `Keycloak didn't redirect (${afterLogin.status}): ${(await afterLogin.text()).slice(0, 300)}`, landed: '' }
  const back = await b.req(cb)
  const landed = back.headers.get('location') ?? ''
  return { ok: back.status === 302 && !landed.includes('error'), error: landed.includes('error') ? landed : back.status === 302 ? '' : `${back.status} ${(await back.text()).slice(0, 300)}`, landed }
}

/** The whole SAML sign-in, SP-initiated. The ACS POST goes without our cookies,
 * as a cross-site form POST from a real browser would (SameSite=Lax). */
async function samlSignIn(b: Browser, username: string, opts: { tamper?: (xml: string) => string; keep?: (form: Record<string, string>) => void } = {}) {
  const start = await b.json('/api/auth/sign-in/sso', { method: 'POST', json: { providerId: SAML_PROVIDER, callbackURL: '/welcome', errorCallbackURL: '/sso-error' } })
  if (!start.body.url) return { ok: false, error: `sign-in/sso ${start.status}: ${JSON.stringify(start.body).slice(0, 200)}`, landed: '' }
  const afterLogin = await kcLogin(b, start.body.url, username)
  const html = await afterLogin.text()
  const acs = formAction(html)
  let samlResponse = hidden(html, 'SAMLResponse')
  const relay = hidden(html, 'RelayState')
  if (!acs || !samlResponse) return { ok: false, error: `no SAML post form (${afterLogin.status}): ${html.slice(0, 300)}`, landed: '' }
  if (opts.tamper) samlResponse = Buffer.from(opts.tamper(Buffer.from(samlResponse, 'base64').toString('utf8'))).toString('base64')
  const form = { SAMLResponse: samlResponse, ...(relay ? { RelayState: relay } : {}) }
  opts.keep?.(form)
  return postAcs(b, acs, form)
}
async function postAcs(b: Browser, acs: string, form: Record<string, string>) {
  const r = await b.req(acs, { method: 'POST', form, noCookies: true, origin: KC_URL })
  const landed = r.headers.get('location') ?? ''
  return { ok: r.status === 302 && !landed.includes('error'), error: r.status === 302 ? (landed.includes('error') ? landed : '') : `${r.status} ${(await r.text()).slice(0, 300)}`, landed, acs }
}

const session = async (b: Browser) => (await b.json('/api/auth/get-session')).body as { user: any; session: any } | null
const spike = async (p: string, json?: unknown) => (await fetch(BASE + p, json === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })).json() as Promise<any>
const sql = (query: string, ...args: unknown[]) => spike('/spike/sql', { query, args }) as Promise<any[]>
async function emailCode(b: Browser, email: string, handle?: string) {
  const sent = await b.json('/api/auth/email-otp/send-verification-otp', { method: 'POST', json: { email, type: 'sign-in' } })
  if (sent.status !== 200) return sent
  const otp = ((await spike('/spike/outbox')) as any[]).filter((m) => m.email === email).at(-1)?.otp
  return b.json('/api/auth/sign-in/email-otp', { method: 'POST', json: { email, otp, ...(handle ? { username: handle } : {}) } })
}
function restart(env: Record<string, string>) {
  const p = Bun.spawnSync(['./restart.sh', env.SPIKE_STORAGE ?? 'actor'], { cwd: import.meta.dir + '/..', env: { ...process.env, ...env } })
  note(`server restarted: ${JSON.stringify(env)} → ${p.stdout.toString().trim()}`)
}
const exchange = async (token: string) => fetch(`${BASE}/ideaf/token`, { method: 'POST', body: JSON.stringify({ token }) })
const scim = (method: string, path: string, body?: unknown, token = SCIM_TOKEN) =>
  fetch(`${BASE}/api/auth/scim/v2${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' }, body: body === undefined ? null : JSON.stringify(body) })

// ---------------------------------------------------------------------------
const run = Date.now().toString(36)
const P = people(run)
const kc = await setupRealm(run)
note(`run ${run}; Keycloak realm ${KC_REALM}`)

// 1. Before the switch: a deployment on email codes, with alice and a
//    personal token, and someone already holding dave's natural handle.
restart({ SPIKE_STORAGE: 'actor' })
const aliceBefore = new Browser()
const a0 = await emailCode(aliceBefore, P.alice.email, `alice-${run}`)
const aliceId = a0.body?.user?.id
const aliceKey = (await aliceBefore.json('/api/auth/api-key/create', { method: 'POST', json: { configId: 'personal', name: 'cli', metadata: { purpose: 'me' } } })).body.key
await emailCode(new Browser(), `someone-${run}@example.org`, `dave-${run}`)
check('before the switch: alice has an account and a personal token (email codes)', !!aliceId && !!aliceKey, { aliceId })

// 2. The switch: single sign-on on.
restart({ SPIKE_STORAGE: 'actor', SPIKE_SSO: '1' })
const blocked = await new Browser().json('/api/auth/email-otp/send-verification-otp', { method: 'POST', json: { email: P.alice.email, type: 'sign-in' } })
check('sso on: email codes refused', blocked.status === 403, blocked)
const pk = await new Browser().json('/api/auth/passkey/generate-authenticate-options', { method: 'GET' })
check('sso on: passkey sign-in refused', pk.status === 403, pk)
const admin = new Browser()
const breakGlass = await emailCode(admin, 'admin@example.com', 'siteadmin')
check('sso on: a site admin can still sign in with an email code (break-glass)', breakGlass.status === 200 && !!breakGlass.body.user, breakGlass.status)

// 3. OIDC (configured in defaultSSO)
const alice = new Browser()
const ao = await oidcSignIn(alice, P.alice.username)
const as = await session(alice)
check('oidc: alice signs in with Keycloak', ao.ok && !!as, ao.error || ao.landed)
check('oidc: matched on primary email to her existing account (same id, handle kept)', as?.user.id === aliceId && as?.user.username === `alice-${run}` && as?.user.handleConfirmed === true, { id: as?.user.id, username: as?.user.username })
check('oidc: session records sign-in method "sso"', as?.session.signInMethod === 'sso', as?.session.signInMethod)
const ex = await exchange(aliceKey)
check('oidc: her personal token from before the switch still works', ex.status === 200, ex.status)

const bob = new Browser()
const bo = await oidcSignIn(bob, P.bob.username)
const bs = await session(bob)
check('oidc: bob (no account yet) gets one automatically', bo.ok && !!bs?.user, bo.error || bo.landed)
check('oidc: his name comes from the provider, handle suggested from the email and unconfirmed', bs?.user.name === 'Bob Baker' && bs?.user.username === `bob-${run}` && bs?.user.handleConfirmed === false, { name: bs?.user.name, username: bs?.user.username, confirmed: bs?.user.handleConfirmed })
const conf = await bob.json('/api/auth/ideaf/confirm-handle', { method: 'POST', json: { handle: `robert-${run}` } })
const again = await bob.json('/api/auth/ideaf/confirm-handle', { method: 'POST', json: { handle: `bobby-${run}` } })
const bs2 = await session(bob)
check('first visit: bob changes his suggested handle once; a second change is refused', conf.status === 200 && again.status === 400 && bs2?.user.username === `robert-${run}`, { first: conf.status, second: again.status, now: bs2?.user.username })
const takenH = await (async () => {
  const c = new Browser()
  await oidcSignIn(c, P.carol.username)
  return c.json('/api/auth/ideaf/confirm-handle', { method: 'POST', json: { handle: `alice-${run}` } })
})()
check('first visit: confirming a handle someone has is refused', takenH.status === 400, takenH)

const dave = new Browser()
await oidcSignIn(dave, P.dave.username)
const ds = await session(dave)
check('oidc: suggested handle avoids one already taken (dave → dave-…-2)', ds?.user.username === `dave-${run}-2`, ds?.user.username)

const eve = new Browser()
const eo = await oidcSignIn(eve, P.eve.username)
const eveRows = await sql(`SELECT id FROM "user" WHERE email = ?`, P.eve.email)
check('oidc: an email outside the allowed domains is refused, and no account is made', !eo.ok && eo.landed.includes('domain_not_allowed') && eveRows.length === 0, eo.landed)

// 4. MCP clients under single sign-on: the authorize request sends the person
//    to the login page, which sends them to the provider and back to the same
//    authorize request.
{
  const b = new Browser()
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const qs = new URLSearchParams({ response_type: 'code', client_id: CLAUDE_CODE, redirect_uri: 'http://localhost:43123/callback', scope: 'openid offline_access ideas:read', state: 's', code_challenge: challenge, code_challenge_method: 'S256', resource: MCP })
  const authorizePath = `/api/auth/oauth2/authorize?${qs}`
  const first = await b.req(authorizePath)
  const toLogin = first.headers.get('location') ?? ''
  const signedIn = await oidcSignIn(b, P.alice.username, authorizePath)
  const resumed = await b.req(signedIn.landed)
  const toConsent = resumed.headers.get('location') ?? ''
  let tokenOk = false
  let claims: any = {}
  if (toConsent.includes('/consent')) {
    const q = new URL(toConsent, BASE).searchParams
    const names = new Set(q.getAll('ba_param'))
    const signed = new URLSearchParams()
    for (const [k, v] of q) if (k === 'sig' || k === 'ba_param' || names.has(k)) signed.append(k, v)
    await b.json('/api/auth/ideaf/oauth-purpose', { method: 'POST', json: { purpose: 'me' } })
    const c = await b.json('/api/auth/oauth2/consent', { method: 'POST', json: { accept: true, oauth_query: signed.toString() } })
    const code = new URL(c.body.url).searchParams.get('code')!
    const t = await fetch(`${BASE}/api/auth/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:43123/callback', client_id: CLAUDE_CODE, code_verifier: verifier, resource: MCP }) })
    const tok = (await t.json()) as any
    tokenOk = t.status === 200 && !!tok.access_token
    claims = tok.access_token ? decodeJwt(tok.access_token) : tok
  }
  check('mcp under sso: authorize → login → Keycloak → back to authorize → consent → token', toLogin.includes('/login') && signedIn.ok && toConsent.includes('/consent') && tokenOk && claims.sub === aliceId, { toLogin: toLogin.slice(0, 60), landed: signedIn.landed.slice(0, 60), toConsent: toConsent.slice(0, 60), sub: claims.sub })
}

// 5. SAML, registered at runtime by a site admin
const descriptor = await (await fetch(`${KC_REALM}/protocol/saml/descriptor`)).text()
const samlBody = {
  providerId: SAML_PROVIDER,
  // For SAML, the top-level issuer is *our* SP entity ID (it replaces samlConfig.issuer).
  issuer: SAML_SP_ENTITY,
  domain: 'acme.test',
  samlConfig: {
    issuer: SAML_SP_ENTITY,
    entryPoint: `${KC_REALM}/protocol/saml`,
    idpMetadata: { metadata: descriptor },
    wantAssertionsSigned: true,
    authnRequestsSigned: true,
    privateKey: spKeys().privateKey,
    identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    mapping: { email: 'email', firstName: 'firstName', lastName: 'lastName' },
  },
}
const byBob = await bob.json('/api/auth/sso/register', { method: 'POST', json: { ...samlBody, providerId: `bob-idp-${run}` } })
check('sso config: someone who is not a site admin cannot add a provider', byBob.status >= 400 && byBob.body?.code !== 'VALIDATION_ERROR', { status: byBob.status, msg: byBob.body?.message })
await admin.json('/api/auth/sso/delete-provider', { method: 'POST', json: { providerId: SAML_PROVIDER } })
const reg = await admin.json('/api/auth/sso/register', { method: 'POST', json: samlBody })
check('sso config: a site admin registers the SAML provider from its metadata', reg.status === 200, { status: reg.status, body: JSON.stringify(reg.body).slice(0, 200) })
const row = (await sql(`SELECT "providerId", "issuer", "domain", "userId", length("samlConfig") AS samlLen, "samlConfig" LIKE '%BEGIN%PRIVATE%' AS hasPrivateKey FROM "ssoProvider" WHERE "providerId" = ?`, SAML_PROVIDER))[0]
note(`ssoProvider row: ${JSON.stringify(row)}`)
const spMeta = await fetch(`${BASE}/api/auth/sso/saml2/sp/metadata?providerId=${SAML_PROVIDER}`)
check('saml: our SP metadata is served for the admin to give the provider', spMeta.status === 200 && (await spMeta.text()).includes(`/sso/saml2/sp/acs/${SAML_PROVIDER}`), spMeta.status)

const frankS = new Browser()
const fs1 = await samlSignIn(frankS, P.frank.username)
const fss = await session(frankS)
check('saml: frank signs in with SAML (ACS POST cross-site, without our cookies); account created', fs1.ok && !!fss?.user && fss.user.email === P.frank.email, fs1.error || fs1.landed)
check('saml: name from the assertion, handle suggested', fss?.user.name?.includes('Frank') && fss?.user.username === `frank-${run}`, { name: fss?.user.name, username: fss?.user.username })
const aliceS = new Browser()
const asl = await samlSignIn(aliceS, P.alice.username)
check('saml: alice via SAML reaches the same account as via OIDC', asl.ok && (await session(aliceS))?.user.id === aliceId, asl.error || asl.landed)

let replayForm: Record<string, string> = {}
let acsUrl = ''
const keepB = new Browser()
const kept = await samlSignIn(keepB, P.bob.username, { keep: (f) => (replayForm = f) })
acsUrl = kept.acs ?? ''
const replay = await postAcs(new Browser(), acsUrl, replayForm)
check('saml: a captured response replayed in another browser is refused', kept.ok && !replay.ok, { first: kept.ok, replay: replay.error || replay.landed })
const tampered = await samlSignIn(new Browser(), P.carol.username, { tamper: (x) => x.replaceAll(P.carol.email, P.alice.email) })
check('saml: a response edited to say another email is refused (signature)', !!tampered.acs && !tampered.ok, tampered.error || tampered.landed)
const unsigned = await samlSignIn(new Browser(), P.carol.username, { tamper: (x) => x.replace(/<(ds:|dsig:)?Signature[\s\S]*?<\/(ds:|dsig:)?Signature>/g, '') })
check('saml: a response with its signatures stripped is refused', !!unsigned.acs && !unsigned.ok, unsigned.error || unsigned.landed)

// 6. Changes at the provider
const bobUser = (await kc('GET', `/realms/ideaf/users?username=${P.bob.username}&exact=true`))[0]
await kc('PUT', `/realms/ideaf/users/${bobUser.id}`, { email: `robert-${run}@acme.test`, emailVerified: true })
const bob2 = new Browser()
const bo2 = await oidcSignIn(bob2, P.bob.username)
const b2s = await session(bob2)
check('provider changes bob\'s email: same account, primary email follows', bo2.ok && b2s?.user.id === bs?.user.id && b2s?.user.email === `robert-${run}@acme.test`, { ok: bo2.ok, id: b2s?.user.id === bs?.user.id, email: b2s?.user.email, err: bo2.error })
await kc('PUT', `/realms/ideaf/users/${bobUser.id}`, { email: P.alice.email, emailVerified: true })
const bo3 = await oidcSignIn(new Browser(), P.bob.username)
check('provider changes bob\'s email to alice\'s: refused', !bo3.ok && bo3.landed.includes('email_taken'), bo3.landed || bo3.error)
await kc('PUT', `/realms/ideaf/users/${bobUser.id}`, { email: `robert-${run}@acme.test`, emailVerified: true })

// 7. SCIM
const wrong = await scim('GET', '/Users', undefined, 'not-the-token')
check('scim: a wrong bearer token is refused', wrong.status === 401, wrong.status)
const grace = await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `grace-${run}@acme.test`, externalId: `ext-grace-${run}`, name: { givenName: 'Grace', familyName: 'Hopper' }, emails: [{ value: `grace-${run}@acme.test`, primary: true }], active: true })
const gj = (await grace.json()) as any
const graceRow = (await sql(`SELECT username, "handleConfirmed", name FROM "user" WHERE email = ?`, `grace-${run}@acme.test`))[0]
check('scim: provider creates grace ahead of her first sign-in (handle suggested)', grace.status === 201 && graceRow?.username === `grace-${run}`, { status: grace.status, row: graceRow, err: gj.detail })
const aliceScim = await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: P.alice.email, externalId: `ext-alice-${run}`, name: { givenName: 'Alice', familyName: 'Archer' }, emails: [{ value: P.alice.email, primary: true }], active: true })
const aj = (await aliceScim.json()) as any
const aliceUsers = await sql(`SELECT id FROM "user" WHERE email = ?`, P.alice.email)
check('scim: provisioning alice links her existing account (no duplicate)', aliceScim.status === 201 && aliceUsers.length === 1 && aliceUsers[0].id === aliceId, { status: aliceScim.status, users: aliceUsers.length, err: aj.detail })
const off = await scim('PATCH', `/Users/${aj.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] })
const aRow = (await sql(`SELECT inactive FROM "user" WHERE id = ?`, aliceId))[0]
const aSessions = await sql(`SELECT count(*) AS n FROM "session" WHERE "userId" = ?`, aliceId)
check('scim: deactivating alice marks her inactive and ends her sessions', off.status === 200 && !!aRow?.inactive && aSessions[0].n === 0, { status: off.status, inactive: aRow?.inactive, sessions: aSessions[0].n })
const aDenied = await oidcSignIn(new Browser(), P.alice.username)
check('scim: alice can no longer sign in, even though the provider would let her', !aDenied.ok && aDenied.landed.includes('inactive'), aDenied.landed || aDenied.error)
const exOff = await exchange(aliceKey)
check('scim: her personal token no longer gets JWTs', exOff.status !== 200, exOff.status)
await scim('PATCH', `/Users/${aj.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: true }] })
const aBack = await oidcSignIn(new Browser(), P.alice.username)
check('scim: reactivated, she can sign in again', aBack.ok, aBack.landed || aBack.error)

// 8. Automatic account creation off: invited people only
restart({ SPIKE_STORAGE: 'actor', SPIKE_SSO: '1', SSO_JIT: '0' })
const carolNo = new Browser()
const cn = await oidcSignIn(carolNo, P.carol.username) // carol has an account already (step 3)
const newbie = await kc('POST', '/realms/ideaf/users', { username: `heidi-${run}`, email: `heidi-${run}@acme.test`, firstName: 'Heidi', lastName: 'H', enabled: true, emailVerified: true, credentials: [{ type: 'password', value: PASSWORD, temporary: false }] })
void newbie
const hn = await oidcSignIn(new Browser(), `heidi-${run}`)
check('automatic creation off: existing accounts sign in; a new person is refused', cn.ok && !hn.ok && hn.landed.includes('no_account'), { carol: cn.ok, heidi: hn.landed || hn.error })

// 9. Approach 1 (custom adapter, no native transactions)
restart({ SPIKE_STORAGE: 'adapter', SPIKE_SSO: '1', SPIKE_DIR_KEY: `sso-${run}` })
const a1 = await oidcSignIn(new Browser(), P.carol.username).catch((e) => ({ ok: false, landed: '', error: `server down: ${(e as Error).message}` }))
const a1log = await Bun.file(import.meta.dir + '/../out/server-adapter.log').text()
const a1why = a1log.match(/requires a database adapter with native transaction support/)?.[0] ?? ''
check('approach 1: SSO fails because SCIM and resolveUser need native transactions (expected)', !a1.ok && !!a1why, a1log.match(/BetterAuthError: [^\n]+/)?.[0] ?? (a1.landed || a1.error))

restart({ SPIKE_STORAGE: 'actor' })
const failed = results.filter((r) => !r[1])
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(0)
