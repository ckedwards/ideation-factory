// Sign-in end to end, through the app as a browser, the cli and a script would
// use it: email codes, handles, personal tokens and their exchange, 15-minute
// JWTs checked by signature, and inactive accounts. Better Auth runs in the
// real directory actor.
import { beforeAll, describe, expect, test } from 'bun:test'
import { createApiClient } from '@ideaf/api'
import { SignJWT, generateKeyPair } from 'jose'
import { DIRECTORY_KEY } from '../actors/directory.ts'
import { createApp } from '../app.ts'
import type { Registry } from '../registry.ts'
import { signIn, startTestActors, TEST_ADMIN, TEST_URL, testAuth, testMailer } from '../testing.ts'
import type { Client } from 'rivetkit/client'

let app: (request: Request) => Promise<Response>
let actors: Client<Registry>
beforeAll(async () => {
  actors = await startTestActors()
  app = createApp({ actors, auth: testAuth, validateOutput: true })
}, 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`

const post = (path: string, body: unknown, cookie?: string) =>
  app(
    new Request(`${TEST_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_URL, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  )
const json = async (response: Response) => ({ status: response.status, body: (await response.json()) as any })
const api = (token: string) => createApiClient({ baseUrl: TEST_URL, token, fetch: (r) => app(r), retries: 0 })
const PLAN = '# Plan\n\nThe quick brown fox.\n'

describe('signing up', () => {
  test('needs a valid handle, and takes no passwords', async () => {
    const email = `${h('new')}@example.test`
    const attempt = async (username?: string) => {
      await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
      return json(
        await post('/api/auth/sign-in/email-otp', {
          email,
          otp: testMailer.code(email),
          ...(username === undefined ? {} : { username }),
        }),
      )
    }
    expect((await attempt()).body.message).toContain('needs a handle')
    expect((await attempt('Not Valid')).status).toBe(400)
    expect((await attempt('settings')).status).toBe(400) // reserved
    expect((await attempt('-dash')).status).toBe(400)
    const ok = await attempt(h('newbie'))
    expect(ok.status).toBe(200)
    expect(ok.body.user).toMatchObject({ email, username: h('newbie') })

    // the directory knows them at once, by the same ID
    const someone = await signIn(app, h('looker'))
    expect(await api(someone.jwt).getUser({ user: h('newbie') })).toMatchObject({
      id: ok.body.user.id,
      handle: h('newbie'),
    })

    // a handle is taken once
    const other = `${h('other')}@example.test`
    await post('/api/auth/email-otp/send-verification-otp', { email: other, type: 'sign-in' })
    const taken = await post('/api/auth/sign-in/email-otp', {
      email: other,
      otp: testMailer.code(other),
      username: h('newbie'),
    })
    expect(taken.status).toBe(400)

    // no passwords, ever
    const password = await post('/api/auth/sign-up/email', { email: other, password: 'password1234', name: 'P' })
    expect(password.ok).toBe(false)
  })
})

describe('tokens', () => {
  test('a personal token works as is, and a bot token labels what it does', async () => {
    const riley = await signIn(app, h('riley'))
    const { idea } = await api(riley.jwt).createIdea({ title: 'Mine', files: [{ path: 'a.md', content: PLAN }] })

    // a bot for riley: comments say so
    const made = await json(
      await post(
        '/api/auth/api-key/create',
        { configId: 'personal', name: 'planbot', metadata: { purpose: 'bot-for-me', bot: 'planbot' } },
        riley.cookie,
      ),
    )
    expect(made.status).toBe(200)
    expect(made.body.key).toStartWith('ideaf_')
    const bot = api(made.body.key)
    await bot.addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'From the bot' })
    const comments = await api(riley.jwt).listComments({ idea })
    expect(comments[0]!.author).toEqual({ user: riley.id, bot: 'planbot', purpose: 'bot-for-me' })
  })

  test('tokens carry no admin powers, bots need names, and only site admins make admin tokens', async () => {
    const riley = await signIn(app, h('riley'))
    const make = async (body: unknown, cookie = riley.cookie) =>
      json(await post('/api/auth/api-key/create', body, cookie))
    expect((await make({ configId: 'personal', name: 'x', metadata: { site_admin: true } })).status).toBe(400)
    expect((await make({ configId: 'personal', name: 'x', metadata: { purpose: 'bot' } })).status).toBe(400)
    expect((await make({ configId: 'personal', metadata: { purpose: 'me' } })).status).toBe(400) // no name
    expect((await make({ configId: 'admin', name: 'ops', metadata: { reason: 'rotate keys' } })).status).toBe(403)

    const admin = await signIn(app, h('admin'), TEST_ADMIN)
    expect((await make({ configId: 'admin', name: 'ops' }, admin.cookie)).status).toBe(400) // no reason
    const ok = await make({ configId: 'admin', name: 'ops', metadata: { reason: 'quarterly audit' } }, admin.cookie)
    expect(ok.status).toBe(200)
    expect(ok.body.key).toStartWith('ideaf_admin_')
  })

  test('a forged, tampered or unknown token is refused', async () => {
    const riley = await signIn(app, h('riley'))
    expect(await api(riley.jwt).me({})).toMatchObject({ id: riley.id })
    const refused = (token: string) => expect(api(token).me({})).rejects.toMatchObject({ code: 'unauthorized' })

    // signed by someone else's key, claiming to be riley
    const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
    await refused(
      await new SignJWT({ purpose: 'me' })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setSubject(riley.id)
        .setIssuer(TEST_URL)
        .setAudience(TEST_URL)
        .setExpirationTime('15m')
        .sign(privateKey),
    )
    // tampered with
    const [head, , signature] = riley.jwt.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'someone-else', purpose: 'me' })).toString('base64url')
    await refused(`${head}.${forged}.${signature}`)
    await refused('ideaf_not-a-real-token')
  })

  test('the site decides who may make and use personal tokens', async () => {
    const riley = await signIn(app, h('riley'))
    const admin = await signIn(app, h('admin'), TEST_ADMIN)
    const make = async (cookie: string) =>
      json(await post('/api/auth/api-key/create', { configId: 'personal', name: 'ci', metadata: {} }, cookie))
    const before = testAuth.personalTokens ?? 'on'
    try {
      // site admins only (the default): theirs work, everyone else's are refused, old ones included
      testAuth.personalTokens = 'admins'
      expect((await make(riley.cookie)).status).toBe(403)
      await expect(api(riley.token).me({})).rejects.toMatchObject({ code: 'unauthorized' })
      expect((await make(admin.cookie)).status).toBe(200)
      expect(await api(admin.token).me({})).toMatchObject({ id: admin.id })
      // off: no one's
      testAuth.personalTokens = 'off'
      expect((await make(admin.cookie)).body.message).toContain('turned off')
      await expect(api(admin.token).me({})).rejects.toMatchObject({ code: 'unauthorized' })
      // access tokens from signing in are unaffected
      expect(await api(riley.jwt).me({})).toMatchObject({ id: riley.id })
    } finally {
      testAuth.personalTokens = before
    }
    expect(await api(riley.token).me({})).toMatchObject({ id: riley.id })
  })
})

describe('an inactive account', () => {
  test('gets no new tokens, and its writes stop at once while reads ride out the token', async () => {
    const sam = await signIn(app, h('sam'))
    const client = api(sam.jwt)
    const { idea } = await client.createIdea({ title: 'Before', files: [{ path: 'a.md', content: PLAN }] })

    const directory = actors.directory.getOrCreate(DIRECTORY_KEY)
    expect(await directory.setInactive(sam.id, true)).toMatchObject({ id: sam.id, inactive: true })

    // the JWT already issued still reads, but can't write
    expect((await client.getIdea({ idea })).title).toBe('Before')
    await expect(
      client.addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'still here?' }),
    ).rejects.toMatchObject({ code: 'forbidden', message: 'this account is inactive' })
    // the personal token stops at once, and the session is gone
    await expect(api(sam.token).me({})).rejects.toMatchObject({ code: 'unauthorized' })
    const session = await app(new Request(`${TEST_URL}/api/auth/get-session`, { headers: { cookie: sam.cookie } }))
    expect(await session.json()).toBeNull()
    // the directory says so too
    expect((await api((await signIn(app, h('looker'))).jwt).getUser({ user: sam.id })).inactive).toBe(true)

    // and back again
    await directory.setInactive(sam.id, false)
    expect(await api(sam.token).me({})).toMatchObject({ id: sam.id })
  })
})
