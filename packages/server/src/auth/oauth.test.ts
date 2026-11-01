// The cli's OAuth sign-in at the HTTP level, as the consent page and the cli
// do it: authorize with PKCE, choose a token grant, consent, exchange the code,
// use and refresh the tokens, and revoke them. Better Auth runs in the real
// directory actor.
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
import { createApiClient } from '@ideaf/api'
import { createApp } from '../app.ts'
import { signIn, startTestActors, TEST_URL, testAuth } from '../testing.ts'
import { CLI_CLIENT_ID, CLI_CODE_PATH } from './config.ts'

let app: (request: Request) => Promise<Response>
beforeAll(async () => {
  app = createApp({ actors: await startTestActors(), auth: testAuth, validateOutput: true })
}, 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`
const api = (token: string) => createApiClient({ baseUrl: TEST_URL, token, fetch: (r) => app(r), retries: 0 })
const PLAN = '# Plan\n\nThe quick brown fox.\n'
const LOOPBACK = 'http://127.0.0.1:53682/callback'

const postJson = async (path: string, body: unknown, cookie: string) => {
  const response = await app(
    new Request(`${TEST_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_URL, cookie },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json().catch(() => null)) as any }
}
const postForm = async (path: string, form: Record<string, string>) => {
  const response = await app(
    new Request(`${TEST_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    }),
  )
  return { status: response.status, body: (await response.json().catch(() => null)) as any }
}

/** The signed part of the query Better Auth sends the consent page, as the page hands it back. */
function signedQuery(location: string): string {
  const params = new URL(location, TEST_URL).searchParams
  const names = new Set(params.getAll('ba_param'))
  const out = new URLSearchParams()
  for (const [name, value] of params.entries()) {
    if (name === 'sig' || name === 'ba_param' || names.has(name)) {
      out.append(name, value)
    }
  }
  return out.toString()
}

/** The cli's sign-in up to the consent page: where the browser lands, and what the cli keeps. */
async function authorize(cookie: string, redirect = LOOPBACK, extra: Record<string, string> = {}) {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLI_CLIENT_ID,
    redirect_uri: redirect,
    scope: 'offline_access',
    state: 'st4te',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: TEST_URL,
    prompt: 'consent',
    ...extra,
  })
  const response = await app(
    new Request(`${TEST_URL}/api/auth/oauth2/authorize?${query}`, { headers: { cookie }, redirect: 'manual' }),
  )
  const location = response.headers.get('location') ?? ''
  return { status: response.status, location, verifier, redirect }
}

/** Consents with a token grant and exchanges the code: the cli's tokens. */
async function signInWith(cookie: string, grant: Record<string, unknown>) {
  const started = await authorize(cookie)
  expect(started.location).toContain('/consent')
  expect((await postJson('/api/auth/ideaf/token-grant', { ...grant, forConsent: true }, cookie)).status).toBe(200)
  const consent = await postJson(
    '/api/auth/oauth2/consent',
    { accept: true, oauth_query: signedQuery(started.location) },
    cookie,
  )
  expect(consent.status).toBe(200)
  const back = new URL(consent.body.url ?? consent.body.redirect_uri)
  expect(back.origin + back.pathname).toBe(LOOPBACK)
  expect(back.searchParams.get('state')).toBe('st4te')
  const tokens = await postForm('/api/auth/oauth2/token', {
    grant_type: 'authorization_code',
    code: back.searchParams.get('code')!,
    redirect_uri: LOOPBACK,
    client_id: CLI_CLIENT_ID,
    code_verifier: started.verifier,
    resource: TEST_URL,
  })
  expect(tokens.status).toBe(200)
  return tokens.body as { access_token: string; refresh_token: string; expires_in: number }
}

describe('ideaf auth login, over OAuth', () => {
  test('a token limited to one team, as a bot for its owner, through refresh and revocation', async () => {
    const riley = await signIn(app, h('riley'))
    const owner = api(riley.jwt)
    const core = await owner.createTeam({ handle: h('core'), name: 'Core' })
    const inCore = (
      await owner.createIdea({ title: 'Core plan', team: core.handle, files: [{ path: 'a.md', content: PLAN }] })
    ).idea
    const mine = (await owner.createIdea({ title: 'Mine', files: [{ path: 'a.md', content: PLAN }] })).idea

    const tokens = await signInWith(riley.cookie, {
      purpose: 'bot-for-me',
      bot: 'planbot',
      limits: { teams: [core.handle] },
    })
    expect(tokens.expires_in).toBe(900)
    expect(tokens.refresh_token).toBeTruthy()
    const bot = api(tokens.access_token)

    // what it is, and what it reaches
    expect(await bot.currentToken({})).toMatchObject({
      user: { id: riley.id },
      purpose: 'bot-for-me',
      bot: 'planbot',
      readOnly: false,
      limits: { teams: [{ id: core.id, handle: core.handle }], ideas: [], noTeam: false },
    })
    expect((await bot.listIdeas({})).items.map((i) => i.id)).toEqual([inCore])
    await expect(bot.getIdea({ idea: mine })).rejects.toMatchObject({ code: 'not_found' })
    await bot.addComment({ idea: inCore, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'From planbot' })
    expect((await owner.listComments({ idea: inCore }))[0]!.author).toEqual({
      user: riley.id,
      bot: 'planbot',
      purpose: 'bot-for-me',
    })
    // limited: no sharing, and new ideas only in its team
    await expect(
      bot.setAccess({ idea: inCore, subject: { kind: 'everyone' }, access: { edit: false, share: false } }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(bot.createIdea({ title: 'Outside', files: [{ path: 'a.md', content: PLAN }] })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(
      (await bot.createIdea({ title: 'Inside', team: core.handle, files: [{ path: 'a.md', content: PLAN }] })).version,
    ).toBe(1)

    // refreshing keeps the grant
    const refreshed = await postForm('/api/auth/oauth2/token', {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLI_CLIENT_ID,
      resource: TEST_URL,
    })
    expect(refreshed.status).toBe(200)
    expect(await api(refreshed.body.access_token).currentToken({})).toMatchObject({
      bot: 'planbot',
      limits: { teams: [{}] },
    })

    // revoking ends it at once, and its refreshes
    expect(await api(refreshed.body.access_token).revokeToken({})).toEqual({ revoked: true })
    expect((await bot.listIdeas({})).items).toEqual([])
    await expect(bot.getIdea({ idea: inCore })).rejects.toMatchObject({ code: 'not_found' })
    const after = await postForm('/api/auth/oauth2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshed.body.refresh_token,
      client_id: CLI_CLIENT_ID,
      resource: TEST_URL,
    })
    expect(after.status).toBeGreaterThanOrEqual(400)
  })

  test('a read-only token writes nothing', async () => {
    const maya = await signIn(app, h('maya'))
    const { idea } = await api(maya.jwt).createIdea({ title: 'Hers', files: [{ path: 'a.md', content: PLAN }] })
    const tokens = await signInWith(maya.cookie, { purpose: 'me', readOnly: true })
    const reader = api(tokens.access_token)
    expect((await reader.getIdea({ idea })).title).toBe('Hers')
    await expect(
      reader.addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'no' }),
    ).rejects.toMatchObject({ code: 'forbidden', message: 'this token is read only' })
    // it can still sign itself out
    expect(await reader.revokeToken({})).toEqual({ revoked: true })
  })

  test('without a browser of its own: the code goes to a page to copy; and the prefill reaches the consent page', async () => {
    const sam = await signIn(app, h('sam'))
    const started = await authorize(sam.cookie, `${TEST_URL}${CLI_CODE_PATH}`, {
      ideaf_bot: 'planbot',
      ideaf_read_only: '1',
    })
    expect(started.location).toContain('/consent')
    const consentUrl = new URL(started.location, TEST_URL)
    expect(consentUrl.searchParams.get('ideaf_bot')).toBe('planbot')
    expect(consentUrl.searchParams.get('ideaf_read_only')).toBe('1')
    await postJson('/api/auth/ideaf/token-grant', { purpose: 'me', forConsent: true }, sam.cookie)
    const consent = await postJson(
      '/api/auth/oauth2/consent',
      { accept: true, oauth_query: signedQuery(started.location) },
      sam.cookie,
    )
    const back = new URL(consent.body.url ?? consent.body.redirect_uri)
    expect(back.pathname).toBe(CLI_CODE_PATH)
    expect(back.searchParams.get('code')).toBeTruthy()
    expect((await app(new Request(back))).status).toBe(200)
  })

  test('refuses what it should', async () => {
    const devon = await signIn(app, h('devon'))
    // no PKCE
    const noPkce = await app(
      new Request(
        `${TEST_URL}/api/auth/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: CLI_CLIENT_ID, redirect_uri: LOOPBACK, scope: 'offline_access', state: 's' })}`,
        { headers: { cookie: devon.cookie }, redirect: 'manual' },
      ),
    )
    expect(noPkce.headers.get('location') ?? '').not.toContain('/consent')
    // a redirect that isn't the cli's
    const elsewhere = await authorize(devon.cookie, 'https://evil.example/callback')
    expect(elsewhere.location).not.toContain('/consent')
    expect(elsewhere.location).not.toContain('evil.example')
    // consenting without choosing a token grant gives no token
    const started = await authorize(devon.cookie)
    const consent = await postJson(
      '/api/auth/oauth2/consent',
      { accept: true, oauth_query: signedQuery(started.location) },
      devon.cookie,
    )
    const back = consent.body?.url ? new URL(consent.body.url) : null
    const code = back?.searchParams.get('code')
    if (code) {
      const tokens = await postForm('/api/auth/oauth2/token', {
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOOPBACK,
        client_id: CLI_CLIENT_ID,
        code_verifier: started.verifier,
        resource: TEST_URL,
      })
      expect(tokens.status).toBeGreaterThanOrEqual(400)
    }
  })
})
