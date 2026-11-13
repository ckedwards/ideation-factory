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

  // a minute on, they're stale: fetched again, once for everyone
  setSystemTime(new Date(Date.now() + 61_000))
  await Promise.all(Array.from({ length: 50 }, () => gateway.authenticate(asking(t), operations.me)))
  expect(fetched.count).toBe(2)
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
