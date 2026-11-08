// Single sign-on, end to end over HTTP the way a browser does it, against a
// fake identity provider in process. The settings are read on every request,
// so each test turns single sign-on on for itself and off again.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
import { createApiClient } from '@ideaf/api'
import type { Client } from 'rivetkit/client'
import { DIRECTORY_KEY } from '../actors/directory.ts'
import { createApp } from '../app.ts'
import type { Registry } from '../registry.ts'
import { type SignedIn, signIn, startTestActors, TEST_ADMIN, TEST_URL, testAuth, testMailer } from '../testing.ts'
import { CLI_CLIENT_ID, SSO_PROVIDER_ID, type SsoSettings } from './config.ts'
import {
  type FakeOidcProvider,
  type FakeSamlProvider,
  fakeOidcProvider,
  fakeSamlProvider,
  type IdpPerson,
} from './fake-idp.ts'

let app: (request: Request) => Promise<Response>
let actors: Client<Registry>
let idp: FakeOidcProvider
let samlIdp: FakeSamlProvider
/** Someone signed in before single sign-on was turned on, to look people up with. */
let looker: SignedIn
beforeAll(async () => {
  actors = await startTestActors()
  app = createApp({ actors, auth: testAuth, validateOutput: true })
  idp = await fakeOidcProvider()
  samlIdp = await fakeSamlProvider()
  looker = await signIn(app, `looker-${crypto.randomUUID().slice(0, 6)}`)
}, 60_000)
afterAll(() => {
  idp.stop()
  samlIdp.stop()
})
afterEach(() => {
  testAuth.sso = null
  testAuth.scimToken = null
})

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`
const person = (name: string, domain = 'acme.test'): IdpPerson => ({
  sub: `sub-${h(name)}`,
  email: `${h(name)}@${domain}`,
  name: name[0]!.toUpperCase() + name.slice(1),
})
const api = (token: string) => createApiClient({ baseUrl: TEST_URL, token, fetch: (r) => app(r), retries: 0 })

function ssoOn(overrides: Partial<SsoSettings> = {}) {
  testAuth.sso = {
    name: 'Acme',
    domains: ['acme.test'],
    autoCreate: true,
    oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret },
    ...overrides,
  }
}

/** A browser: cookies for our site, following redirects between it and the identity provider. */
class Browser {
  cookies = new Map<string, string>()

  /** `crossSite`: a post from another site's page, which carries none of our (SameSite=Lax) cookies. */
  async fetch(url: string, init: RequestInit & { crossSite?: boolean } = {}): Promise<Response> {
    const target = new URL(url, TEST_URL)
    const ours = target.origin === new URL(TEST_URL).origin
    const headers = new Headers(init.headers)
    if (ours && this.cookies.size > 0 && !init.crossSite) {
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    if (ours && init.method && init.method !== 'GET' && !init.crossSite) {
      headers.set('origin', TEST_URL)
    }
    const request = new Request(target, { ...init, headers, redirect: 'manual' })
    const response = ours ? await app(request) : await fetch(request)
    if (ours) {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';')
        const [name, ...value] = pair!.split('=')
        if (/max-age=0/i.test(cookie)) {
          this.cookies.delete(name!.trim())
        } else {
          this.cookies.set(name!.trim(), value.join('='))
        }
      }
    }
    return response
  }

  /** Follows redirects until a page that isn't one; returns where it landed. */
  async follow(response: Response): Promise<URL> {
    let current = response
    let at = new URL(response.url || TEST_URL)
    for (let i = 0; i < 10 && current.status >= 300 && current.status < 400; i++) {
      at = new URL(current.headers.get('location')!, at)
      current = await this.fetch(at.toString())
    }
    return at
  }

  async post(path: string, body: unknown) {
    const response = await this.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: (await response.json().catch(() => null)) as any }
  }

  async user() {
    const response = await this.fetch('/api/auth/get-session')
    return ((await response.json().catch(() => null)) as any)?.user ?? null
  }

  /** "Continue with Acme", as the sign-in page does it; where the browser ends up. */
  async ssoSignIn(as: IdpPerson, callbackURL = '/login'): Promise<URL> {
    idp.as(as)
    const started = await this.post('/api/auth/sign-in/sso', {
      providerId: SSO_PROVIDER_ID,
      callbackURL,
      errorCallbackURL: '/login',
    })
    expect(started.status).toBe(200)
    return this.follow(await this.fetch(started.body.url))
  }

  /**
   * "Continue with Acme" under SAML: the provider's page posts its signed
   * response back to us from its own site. `keep` sees the form, `edit`
   * changes the response before it's posted.
   */
  async samlSignIn(
    as: IdpPerson,
    options: { edit?: (xml: string) => string; keep?: (form: Record<string, string>) => void } = {},
  ): Promise<URL> {
    samlIdp.as(as, options.edit)
    const started = await this.post('/api/auth/sign-in/sso', {
      providerId: SSO_PROVIDER_ID,
      callbackURL: '/login',
      errorCallbackURL: '/login',
    })
    expect(started.status).toBe(200)
    const page = await (await this.fetch(started.body.url)).text()
    const action = page.match(/action="([^"]+)"/)![1]!.replaceAll('&amp;', '&')
    const form: Record<string, string> = {}
    for (const [, name, value] of page.matchAll(/name="(\w+)" value="([^"]*)"/g)) {
      form[name!] = value!.replaceAll('&amp;', '&')
    }
    options.keep?.(form)
    return this.postAcs(action, form)
  }

  async postAcs(action: string, form: Record<string, string>): Promise<URL> {
    return this.follow(
      await this.fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
        crossSite: true,
      }),
    )
  }
}

describe('single sign-on with OIDC', () => {
  test('someone new gets an account, with a handle from their email to keep or change once', async () => {
    ssoOn()
    const carol = person('carol.jones')
    const browser = new Browser()
    const landed = await browser.ssoSignIn(carol)
    expect(landed.pathname).toBe('/login')
    expect(landed.searchParams.get('error')).toBeNull()
    const user = await browser.user()
    expect(user).toMatchObject({ email: carol.email, name: 'Carol.jones', handleConfirmed: false })
    expect(user.username).toBe(h('carol-jones'))
  })

  test("a suggestion that's someone's parked handle is passed over, so it keeps leading to them", async () => {
    // made now, while email codes still work: then they rename, parking their old handle
    const first = await signIn(app, h('erin'), `${h('erin')}@elsewhere.test`)
    const renamed = await app(
      new Request(`${TEST_URL}/api/auth/update-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: TEST_URL, cookie: first.cookie },
        body: JSON.stringify({ username: h('erin-now') }),
      }),
    )
    expect(renamed.status).toBe(200)
    ssoOn()
    const browser = new Browser()
    await browser.ssoSignIn(person('erin'))
    expect((await browser.user()).username).toBe(`${h('erin')}-2`)
    expect(await api(looker.jwt).getUser({ user: h('erin') })).toMatchObject({ id: first.id, handle: h('erin-now') })
  })

  test('the handle is confirmed once: a taken or invalid one is refused, and the directory follows', async () => {
    ssoOn()
    const dana = person('dana')
    const browser = new Browser()
    await browser.ssoSignIn(dana)
    expect((await browser.user()).handleConfirmed).toBe(false)
    expect((await browser.post('/api/auth/ideaf/confirm-handle', { handle: looker.handle })).status).toBe(400)
    expect((await browser.post('/api/auth/ideaf/confirm-handle', { handle: 'Not Valid' })).status).toBe(400)
    const done = await browser.post('/api/auth/ideaf/confirm-handle', { handle: h('dee') })
    expect(done).toEqual({ status: 200, body: { handle: h('dee') } })
    expect(await browser.user()).toMatchObject({ username: h('dee'), handleConfirmed: true })
    // once only
    expect((await browser.post('/api/auth/ideaf/confirm-handle', { handle: h('dana-2') })).status).toBe(400)
    // the directory knows them by the new handle, not the suggested one
    const lookup = api(looker.jwt)
    expect(await lookup.getUser({ user: h('dee') })).toMatchObject({ handle: h('dee'), name: 'Dana' })
    await expect(lookup.getUser({ user: h('dana') })).rejects.toMatchObject({ code: 'not_found' })
  })

  test('someone with an account already reaches it, handle and all, matched on their email', async () => {
    const before = await signIn(app, h('alice'), `${h('alice')}@acme.test`)
    // made now, while email codes still work
    await signIn(app, h('bob'), `${h('bob')}@acme.test`)
    ssoOn()
    const browser = new Browser()
    await browser.ssoSignIn({ sub: `sub-${h('alice')}`, email: before.email, name: 'Alice' })
    expect(await browser.user()).toMatchObject({ id: before.id, username: before.handle, handleConfirmed: true })
    // and next time by their provider identity, even after the provider changes their email
    const moved = `${h('alice.smith')}@acme.test`
    const again = new Browser()
    await again.ssoSignIn({ sub: `sub-${h('alice')}`, email: moved, name: 'Alice' })
    expect(await again.user()).toMatchObject({ id: before.id, email: moved })
    // but not to an email another account has
    const bob = await signIn(app, h('bob'), `${h('bob')}@acme.test`)
    const taken = new Browser()
    const refused = await taken.ssoSignIn({ sub: `sub-${h('alice')}`, email: bob.email, name: 'Alice' })
    expect(refused.searchParams.get('error')).toBeTruthy()
    expect(await taken.user()).toBeNull()
  })

  test('refuses emails outside the allowed domains, inactive accounts, and new people when accounts aren’t made automatically', async () => {
    ssoOn()
    const outsider = new Browser()
    const landed = await outsider.ssoSignIn(person('eve', 'elsewhere.test'))
    expect(landed.pathname).toBe('/login')
    expect(landed.searchParams.get('error')).toBeTruthy()
    expect(await outsider.user()).toBeNull()

    const frank = person('frank')
    const first = new Browser()
    await first.ssoSignIn(frank)
    const frankId = (await first.user()).id
    const directory = actors.directory.getOrCreate(DIRECTORY_KEY)
    await directory.setInactive(frankId, true)
    const later = new Browser()
    expect((await later.ssoSignIn(frank)).searchParams.get('error')).toBeTruthy()
    expect(await later.user()).toBeNull()
    await directory.setInactive(frankId, false)

    ssoOn({ autoCreate: false })
    const newcomer = new Browser()
    expect((await newcomer.ssoSignIn(person('gina'))).searchParams.get('error')).toBeTruthy()
    expect(await newcomer.user()).toBeNull()
    // people with accounts still get in
    const back = new Browser()
    await back.ssoSignIn(frank)
    expect((await back.user()).id).toBe(frankId)
  })

  test('email codes and passkeys are off, except an email code for site admins', async () => {
    ssoOn()
    const browser = new Browser()
    const someone = await browser.post('/api/auth/email-otp/send-verification-otp', {
      email: `${h('hal')}@acme.test`,
      type: 'sign-in',
    })
    expect(someone.status).toBe(403)
    expect(someone.body.message).toContain('Acme')
    expect(
      (await browser.post('/api/auth/sign-in/email-otp', { email: `${h('hal')}@acme.test`, otp: '123456' })).status,
    ).toBe(403)
    expect((await browser.post('/api/auth/passkey/verify-authentication', { response: {} })).status).toBe(403)
    // a site admin's code works: the way in when the provider is down
    expect(
      (await browser.post('/api/auth/email-otp/send-verification-otp', { email: TEST_ADMIN, type: 'sign-in' })).status,
    ).toBe(200)
    const admin = await browser.post('/api/auth/sign-in/email-otp', {
      email: TEST_ADMIN,
      otp: testMailer.code(TEST_ADMIN),
      username: h('admin'),
      name: 'Admin',
    })
    expect(admin.status).toBe(200)
  })

  test('the sign-in page offers the provider only while single sign-on is on', async () => {
    const off = await (await app(new Request(`${TEST_URL}/login`))).text()
    expect(off).toContain('const SSO = null')
    ssoOn()
    const on = await (await app(new Request(`${TEST_URL}/login`))).text()
    expect(on).toContain(`"providerId":"${SSO_PROVIDER_ID}"`)
    expect(on).toContain('"name":"Acme"')
    testAuth.sso = null
    expect(
      (await new Browser().post('/api/auth/sign-in/sso', { providerId: SSO_PROVIDER_ID, callbackURL: '/login' }))
        .status,
    ).toBeGreaterThanOrEqual(400)
  })

  test('ideaf auth login: authorize, the provider, back to authorize, then consent and a token', async () => {
    ssoOn()
    const browser = new Browser()
    const verifier = randomBytes(32).toString('base64url')
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: CLI_CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:53682/callback',
      scope: 'offline_access',
      state: 'st4te',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: TEST_URL,
      prompt: 'consent',
    })
    // not signed in: the sign-in page, with the signed authorize request
    const toLogin = new URL(
      (await browser.fetch(`/api/auth/oauth2/authorize?${query}`)).headers.get('location')!,
      TEST_URL,
    )
    expect(toLogin.pathname).toBe('/login')
    // what the page's "Continue with Acme" sends as the way back: the authorize request, unsigned
    const back = new URLSearchParams()
    for (const [name, value] of toLogin.searchParams) {
      if (name !== 'sig' && name !== 'ba_param') {
        back.append(name, value)
      }
    }
    const landed = await browser.ssoSignIn(person('ivy'), `/api/auth/oauth2/authorize?${back}`)
    expect(landed.pathname).toBe('/consent')
    // the consent page: a token grant, then consent
    expect((await browser.post('/api/auth/ideaf/token-grant', { purpose: 'me', forConsent: true })).status).toBe(200)
    const signed = new URLSearchParams()
    const names = new Set(landed.searchParams.getAll('ba_param'))
    for (const [name, value] of landed.searchParams) {
      if (name === 'sig' || name === 'ba_param' || names.has(name)) {
        signed.append(name, value)
      }
    }
    const consent = await browser.post('/api/auth/oauth2/consent', { accept: true, oauth_query: signed.toString() })
    expect(consent.status).toBe(200)
    const code = new URL(consent.body.url).searchParams.get('code')!
    const tokens = await app(
      new Request(`${TEST_URL}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'http://127.0.0.1:53682/callback',
          client_id: CLI_CLIENT_ID,
          code_verifier: verifier,
          resource: TEST_URL,
        }),
      }),
    )
    expect(tokens.status).toBe(200)
    const { access_token } = (await tokens.json()) as { access_token: string }
    expect((await api(access_token).currentToken({})).user.handle).toBe(h('ivy'))
  })
})

describe('single sign-on with SAML', () => {
  const samlOn = async () => {
    testAuth.sso = { name: 'Acme', domains: ['acme.test'], autoCreate: true, saml: { metadata: samlIdp.metadata } }
    // the site admin gives the provider our metadata
    const ours = await app(new Request(`${TEST_URL}/api/auth/sso/saml2/sp/metadata?providerId=${SSO_PROVIDER_ID}`))
    expect(ours.status).toBe(200)
    samlIdp.trust(await ours.text())
  }

  test('someone new gets an account, named from the response, with a handle to confirm', async () => {
    await samlOn()
    const browser = new Browser()
    const landed = await browser.samlSignIn({
      sub: `saml-${h('kim')}`,
      email: `${h('kim')}@acme.test`,
      name: 'Kim Lee',
    })
    expect(landed.searchParams.get('error')).toBeNull()
    expect(await browser.user()).toMatchObject({
      email: `${h('kim')}@acme.test`,
      name: 'Kim Lee',
      username: h('kim'),
      handleConfirmed: false,
    })
  })

  test('someone with an account already reaches it, matched on their email', async () => {
    const before = await signIn(app, h('lou'), `${h('lou')}@acme.test`)
    await samlOn()
    const browser = new Browser()
    await browser.samlSignIn({ sub: `saml-${h('lou')}`, email: before.email, name: 'Lou Reed' })
    expect(await browser.user()).toMatchObject({ id: before.id, username: before.handle })
  })

  test('refuses a replayed response, one edited to name someone else, and one with its signatures stripped', async () => {
    const victim = await signIn(app, h('mo'), `${h('mo')}@acme.test`)
    await samlOn()
    let captured: Record<string, string> = {}
    const first = new Browser()
    const action = await first.samlSignIn(
      { sub: `saml-${h('ned')}`, email: `${h('ned')}@acme.test`, name: 'Ned Kelly' },
      { keep: (form) => (captured = form) },
    )
    expect(await first.user()).toMatchObject({ email: `${h('ned')}@acme.test` })
    void action
    // the same response, posted again from another browser
    const replay = new Browser()
    await replay.postAcs(`${TEST_URL}/api/auth/sso/saml2/sp/acs/${SSO_PROVIDER_ID}`, captured)
    expect(await replay.user()).toBeNull()

    const edited = new Browser()
    await edited.samlSignIn(
      { sub: `saml-${h('olga')}`, email: `${h('olga')}@acme.test`, name: 'Olga' },
      { edit: (xml) => xml.replaceAll(`${h('olga')}@acme.test`, victim.email) },
    )
    expect(await edited.user()).toBeNull()

    const stripped = new Browser()
    await stripped.samlSignIn(
      { sub: `saml-${h('pat')}`, email: `${h('pat')}@acme.test`, name: 'Pat' },
      { edit: (xml) => xml.replace(/<(ds:)?Signature[\s\S]*?<\/(ds:)?Signature>/g, '') },
    )
    expect(await stripped.user()).toBeNull()
  })
})

describe('SCIM from the identity provider', () => {
  const TOKEN = 'scim-test-token-0123456789-abcdefghij'
  const scim = async (method: string, path: string, body?: unknown, token = TOKEN) => {
    const response = await app(
      new Request(`${TEST_URL}/api/auth/scim/v2${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    return { status: response.status, body: (await response.json().catch(() => null)) as any }
  }
  const scimUser = (name: string, email: string, active = true) => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    externalId: `ext-${name}`,
    userName: email,
    name: { givenName: name, familyName: 'Test' },
    emails: [{ value: email, primary: true }],
    active,
  })
  const setActive = (id: string, active: boolean) =>
    scim('PATCH', `/Users/${id}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'active', value: active }],
    })

  test('off without a token, and only for people: a wrong token and groups are refused', async () => {
    expect((await scim('GET', '/Users')).status).toBe(401)
    testAuth.scimToken = TOKEN
    expect((await scim('GET', '/Users', undefined, 'not-the-token-not-the-token-0123456')).status).toBe(401)
    expect((await scim('GET', '/Users')).status).toBe(200)
    expect((await scim('GET', '/Groups')).status).toBe(403)
  })

  test('makes an account ahead of the first sign-in, which the directory knows', async () => {
    testAuth.scimToken = TOKEN
    const made = await scim('POST', '/Users', scimUser(h('quinn'), `${h('quinn')}@acme.test`))
    expect(made.status).toBe(201)
    const quinn = await api(looker.jwt).getUser({ user: h('quinn') })
    expect(quinn).toMatchObject({ handle: h('quinn'), inactive: false })
    // they sign in later through single sign-on, to the same account, and confirm the handle
    ssoOn()
    const browser = new Browser()
    await browser.ssoSignIn({ sub: `sub-${h('quinn')}`, email: `${h('quinn')}@acme.test`, name: 'Quinn' })
    expect(await browser.user()).toMatchObject({ id: quinn.id, handleConfirmed: false })
  })

  test('deactivating someone signs them out everywhere and stops their writes; reactivating lets them back', async () => {
    const rae = await signIn(app, h('rae'), `${h('rae')}@acme.test`)
    testAuth.scimToken = TOKEN
    // someone with an account already is linked, not duplicated
    const linked = await scim('POST', '/Users', scimUser(h('rae'), rae.email))
    expect(linked.status).toBe(201)
    const deactivated = await setActive(linked.body.id, false)
    expect(deactivated.status).toBe(200)
    expect(await api(looker.jwt).getUser({ user: rae.handle })).toMatchObject({ id: rae.id, inactive: true })
    // their session is gone, and their access token can't write
    const session = await app(new Request(`${TEST_URL}/api/auth/get-session`, { headers: { cookie: rae.cookie } }))
    expect(await session.json()).toBeNull()
    await expect(
      api(rae.jwt).createIdea({ title: 'Nope', files: [{ path: 'a.md', content: '# A\n' }] }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect((await setActive(linked.body.id, true)).status).toBe(200)
    expect(await api(looker.jwt).getUser({ user: rae.handle })).toMatchObject({ inactive: false })
    expect(
      (await api(rae.jwt).createIdea({ title: 'Back', files: [{ path: 'a.md', content: '# A\n' }] })).version,
    ).toBe(1)
  })
})
