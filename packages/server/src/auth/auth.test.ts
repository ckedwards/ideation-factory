// Sign-in end to end, through the app as a browser, the cli and a script would
// use it: email codes, handles, personal tokens and their exchange, 15-minute
// JWTs checked by signature, and inactive accounts. Better Auth runs in the
// real directory actor.
import { beforeAll, describe, expect, test } from 'bun:test'
import { createApiClient } from '@ideaf/api'
import { SignJWT, decodeProtectedHeader, generateKeyPair } from 'jose'
import { admin } from '../admin.ts'
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

  test('a first sign-in takes one code: the login page checks it, and the handle, before using it', async () => {
    const email = `${h('first')}@example.test`
    await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
    const otp = testMailer.code(email)
    const check = (code: string) =>
      post('/api/auth/email-otp/check-verification-otp', { email, otp: code, type: 'sign-in' })

    // a wrong code is just wrong; the right one says there's no account yet, and stays usable
    expect((await json(await check('000000'))).body.code).toBe('INVALID_OTP')
    expect((await json(await check(otp))).body.code).toBe('USER_NOT_FOUND')
    expect((await json(await check(otp))).body.code).toBe('USER_NOT_FOUND')

    // the handle: taken, reserved or malformed is caught before the code is used
    await signIn(app, h('taken'))
    const available = async (username: string) => json(await post('/api/auth/is-username-available', { username }))
    expect((await available(h('taken'))).body).toEqual({ available: false })
    expect((await available('settings')).status).toBe(422)
    expect((await available('Not Valid')).status).toBe(422)
    expect((await available(h('first'))).body).toEqual({ available: true })

    // and the same code signs them up
    const done = await json(await post('/api/auth/sign-in/email-otp', { email, otp, username: h('first') }))
    expect(done.status).toBe(200)
    expect(done.body.user).toMatchObject({ email, username: h('first') })
    // a returning user's code checks out
    await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
    expect((await json(await check(testMailer.code(email)))).body).toEqual({ success: true })
  })
})

describe('sign-in codes', () => {
  test('a code that can’t be sent says so, so the person can try again', async () => {
    const working = testAuth.mailer
    testAuth.mailer = {
      sendCode: async () => {
        throw new Error('connect ECONNREFUSED')
      },
    }
    try {
      const sent = await json(
        await post('/api/auth/email-otp/send-verification-otp', {
          email: `${h('lost')}@example.test`,
          type: 'sign-in',
        }),
      )
      expect(sent.status).toBe(503)
      expect(sent.body.message).toContain('try again')
    } finally {
      testAuth.mailer = working
    }
  })
})

describe('tokens', () => {
  test('after the signing key is rotated (bun packages/server/src/admin.ts), old and new tokens both work', async () => {
    const pat = await signIn(app, h('pat'))
    const fresh = async () => {
      const response = await app(
        new Request(`${TEST_URL}/api/auth/token`, { headers: { cookie: pat.cookie, origin: TEST_URL } }),
      )
      return ((await response.json()) as { token: string }).token
    }
    const before = await fresh()
    await api(before).getUser({ user: pat.handle })
    expect(await admin(['rotate-signing-key'], process.env)).toBe(0)
    const after = await fresh()
    expect(decodeProtectedHeader(after).kid).not.toBe(decodeProtectedHeader(before).kid)
    // the app node fetches the new key when it first sees it, and still has the old one
    expect((await api(after).getUser({ user: pat.handle })).id).toBe(pat.id)
    expect((await api(before).getUser({ user: pat.handle })).id).toBe(pat.id)
    expect(await admin(['rotate-signing-key', '--sideways'], process.env)).toBe(2)
  })

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
  test('a site admin deactivates and reactivates someone by handle (bun packages/server/src/admin.ts)', async () => {
    const lee = await signIn(app, h('lee'))
    const looker = api((await signIn(app, h('lee-looker'))).jwt)
    expect(await admin(['deactivate', lee.handle], process.env)).toBe(0)
    expect(await looker.getUser({ user: lee.handle })).toMatchObject({ inactive: true })
    await expect(
      api(lee.jwt).createIdea({ title: 'Gone', files: [{ path: 'a.md', content: PLAN }] }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const session = await app(new Request(`${TEST_URL}/api/auth/get-session`, { headers: { cookie: lee.cookie } }))
    expect(await session.json()).toBeNull()

    expect(await admin(['reactivate', lee.id], process.env)).toBe(0)
    expect(await looker.getUser({ user: lee.handle })).toMatchObject({ inactive: false })
    expect(await admin(['deactivate', h('nobody')], process.env)).toBe(1)
    expect(await admin(['deactivate'], process.env)).toBe(2)
  })

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

describe('changing handles', () => {
  test("a person's handle changes; the old one leads to them until someone else takes it; a site admin can release one", async () => {
    const riley = await signIn(app, h('renamer'))
    const looker = api((await signIn(app, h('rename-looker'))).jwt)
    const renamed = h('renamed')
    expect((await post('/api/auth/update-user', { username: renamed }, riley.cookie)).status).toBe(200)
    // the directory follows, and the old handle still finds them
    expect(await looker.getUser({ user: renamed })).toMatchObject({ id: riley.id, handle: renamed })
    expect(await looker.getUser({ user: riley.handle })).toMatchObject({ id: riley.id, handle: renamed })
    // someone else's handle can't be taken
    expect((await post('/api/auth/update-user', { username: h('rename-looker') }, riley.cookie)).status).toBe(400)

    // the old handle is kept for them: nobody new can sign up with it, or be told it's free
    const email = `${h('taker')}@example.test`
    await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
    const refused = await json(
      await post('/api/auth/sign-in/email-otp', { email, otp: testMailer.code(email), username: riley.handle }),
    )
    expect(refused).toMatchObject({ status: 400, body: { code: 'HANDLE_PARKED' } })
    expect((await post('/api/auth/is-username-available', { username: riley.handle })).status).toBe(400)
    // but they can take it back, and leave it again
    expect((await post('/api/auth/update-user', { username: riley.handle }, riley.cookie)).status).toBe(200)
    expect((await post('/api/auth/update-user', { username: renamed }, riley.cookie)).status).toBe(200)

    // a site admin releases it: someone new takes it, and it's theirs now
    expect(await admin(['release-handle', `@${riley.handle}`], process.env)).toBe(0)
    // (signed up directly: the test helper knows people by handle, and this one was riley's)
    await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
    const taken = await json(
      await post('/api/auth/sign-in/email-otp', { email, otp: testMailer.code(email), username: riley.handle }),
    )
    expect(taken.status).toBe(200)
    expect(await looker.getUser({ user: riley.handle })).toMatchObject({ id: taken.body.user.id })

    // a site admin frees the new one: its holder gets a generated handle, and it leads nowhere
    expect(await admin(['release-handle', `@${renamed}`], process.env)).toBe(0)
    await expect(looker.getUser({ user: renamed })).rejects.toMatchObject({ code: 'not_found' })
    expect((await looker.getUser({ user: riley.id })).handle).toStartWith('released-')
    expect(await admin(['release-handle', `@${renamed}`], process.env)).toBe(1)
  })
})
