// Checking JWTs on an app node: the signing keys are fetched once at a time,
// however many requests find them stale together, and a node that can't fetch
// them says so (unavailable, 503) rather than calling a good token bad (401).
import { afterEach, expect, setSystemTime, test } from 'bun:test'
import { operations } from '@ideaf/api'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { authGateway, type AuthDirectory } from './gateway.ts'
import type { WireResponse } from './in-directory.ts'

const BASE = 'https://ideas.example.test'

afterEach(() => setSystemTime())

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'EdDSA' }
  const token = (sub: string) =>
    new SignJWT({ purpose: 'me' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setSubject(sub)
      .setIssuer(BASE)
      .setAudience(BASE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey)
  return { jwks: { keys: [jwk] }, token }
}

/** A directory answering /api/auth/jwks as told, counting the fetches. */
function directory(answer: () => Promise<WireResponse>) {
  const fetched = { count: 0 }
  const d: AuthDirectory = {
    auth: async (wire) => {
      if (new URL(wire.url).pathname !== '/api/auth/jwks') {
        throw new Error(`unexpected ${wire.url}`)
      }
      fetched.count++
      return answer()
    },
    verifyToken: async () => null,
    user: async () => ({ inactive: false }),
  }
  return { d, fetched }
}

const json = (body: unknown, status = 200): WireResponse => ({
  status,
  headers: [['content-type', 'application/json']],
  body: Buffer.from(JSON.stringify(body)).toString('base64'),
})

const asking = (token: string) => new Request(`${BASE}/api/me`, { headers: { authorization: `Bearer ${token}` } })

test('requests that find the keys missing or stale together share one fetch', async () => {
  const { jwks, token } = await signer()
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  const { d, fetched } = directory(async () => {
    await held
    return json(jwks)
  })
  const gateway = authGateway(d, BASE)
  const t = await token('u1')
  const waiting = Array.from({ length: 50 }, () => gateway.authenticate(asking(t), operations.me))
  release()
  for (const who of await Promise.all(waiting)) {
    expect(who).toMatchObject({ caller: { user: 'u1' } })
  }
  expect(fetched.count).toBe(1)
})

/** A gateway whose directory serves the keys once, then answers as `next` says (held until released, or failing). */
async function aging() {
  const { jwks, token } = await signer()
  let next: 'serve' | 'hold' | 'fail' = 'serve'
  let release = () => {}
  const { d, fetched } = directory(async () => {
    if (next === 'fail') {
      return json({ message: 'Too many requests' }, 429)
    }
    if (next === 'hold') {
      await new Promise<void>((r) => (release = r))
    }
    return json(jwks)
  })
  const gateway = authGateway(d, BASE)
  const t = await token('u1')
  const start = Date.now()
  const at = (seconds: number) => setSystemTime(new Date(start + seconds * 1000))
  const ask = () => gateway.authenticate(asking(t), operations.me)
  expect(await ask()).toMatchObject({ caller: { user: 'u1' } })
  return {
    ask,
    at,
    fetched,
    answer: (n: typeof next) => (next = n),
    release: () => release(),
  }
}

test('from 50 s the keys are fetched again in the background: requests don’t wait for it', async () => {
  const g = await aging()
  g.answer('hold')
  g.at(51)
  // answered with the keys in hand while the refresh is held
  const answers = await Promise.all(Array.from({ length: 20 }, () => g.ask()))
  for (const who of answers) {
    expect(who).toMatchObject({ caller: { user: 'u1' } })
  }
  expect(g.fetched.count).toBe(2)
  g.release()
})

test('while a refresh hasn’t come back, the keys stand in for up to 30 s past the minute, then requests wait for them', async () => {
  const g = await aging()
  g.answer('fail')
  // past the minute, the refresh failing: the keys in hand still answer
  for (const seconds of [61, 75, 89]) {
    g.at(seconds)
    expect(await g.ask()).toMatchObject({ caller: { user: 'u1' } })
  }
  // past 90 s they no longer may: without keys, a token can't be checked
  g.at(91)
  expect(await g.ask()).toMatchObject({ code: 'unavailable' })
  // and once the directory answers again, all's well
  g.answer('serve')
  g.at(92)
  expect(await g.ask()).toMatchObject({ caller: { user: 'u1' } })
})

test('keys that can’t be fetched make a token unavailable to check, not unauthorized', async () => {
  const { jwks, token } = await signer()
  let fail: 'status' | 'throw' | null = 'status'
  const { d, fetched } = directory(async () => {
    if (fail === 'status') {
      return json({ message: 'Too many requests' }, 429)
    }
    if (fail === 'throw') {
      throw new Error('the directory is busy')
    }
    return json(jwks)
  })
  const gateway = authGateway(d, BASE)
  const t = await token('u1')
  expect(await gateway.authenticate(asking(t), operations.me)).toMatchObject({ code: 'unavailable' })
  fail = 'throw'
  expect(await gateway.authenticate(asking(t), operations.me)).toMatchObject({ code: 'unavailable' })
  // nothing bad was kept: the next request fetches again, and the token is good
  fail = null
  expect(await gateway.authenticate(asking(t), operations.me)).toMatchObject({ caller: { user: 'u1' } })
  expect(fetched.count).toBe(3)
})

test('a token the keys don’t vouch for is still unauthorized', async () => {
  const ours = await signer()
  const theirs = await signer()
  const { d } = directory(async () => json(ours.jwks))
  const gateway = authGateway(d, BASE)
  // same key ID, another key: the signature fails
  expect(await gateway.authenticate(asking(await theirs.token('u1')), operations.me)).toBeNull()
})
