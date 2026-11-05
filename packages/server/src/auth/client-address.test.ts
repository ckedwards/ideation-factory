// Who a sign-in request came from, as sign-in's rate limits count it: worked
// out on the app node, from who connected and, only through a trusted proxy,
// from X-Forwarded-For. Then the real rate limiter, on a Better Auth of its
// own with limits on, reached through the gateway as the app reaches it.
import { describe, expect, test } from 'bun:test'
import { bunSql } from '../sql/sql-bun.ts'
import { TEST_URL, testAuth } from '../testing.ts'
import { type AuthSettings, CLIENT_IP_HEADER, makeAuth } from './config.ts'
import { ActorSqliteDialect } from './dialect.ts'
import { authGateway, clientAddress } from './gateway.ts'
import { handleAuthRequest, migrateAuth, type WireRequest } from './in-directory.ts'

const PROXIES = ['10.0.0.0/24', '192.0.2.10']

describe('the client’s address', () => {
  test('with no trusted proxies, whoever connected; X-Forwarded-For is ignored', () => {
    expect(clientAddress('203.0.113.7', null)).toBe('203.0.113.7')
    expect(clientAddress('203.0.113.7', '198.51.100.1')).toBe('203.0.113.7')
    expect(clientAddress('::ffff:203.0.113.7', null)).toBe('203.0.113.7')
    expect(clientAddress(undefined, '198.51.100.1')).toBeNull()
  })

  test('through a trusted proxy, the first address in X-Forwarded-For that isn’t a proxy, from the right', () => {
    expect(clientAddress('10.0.0.5', '203.0.113.7', PROXIES)).toBe('203.0.113.7')
    // a client's own made-up entries sit to the left of what the proxies added
    expect(clientAddress('10.0.0.5', '1.2.3.4, 203.0.113.7, 192.0.2.10', PROXIES)).toBe('203.0.113.7')
  })

  test('not through a trusted proxy, whoever connected, whatever X-Forwarded-For says', () => {
    expect(clientAddress('203.0.113.7', '10.0.0.5', PROXIES)).toBe('203.0.113.7')
    expect(clientAddress('203.0.113.7', '198.51.100.1, 10.0.0.5', PROXIES)).toBe('203.0.113.7')
  })
})

describe('sign-in’s rate limits', () => {
  /** A gateway in front of a Better Auth of its own, with rate limits on; what Better Auth was told. */
  async function limited(trustedProxies: readonly string[] = []) {
    const sql = bunSql()
    const settings: AuthSettings = { ...testAuth, rateLimit: true, sso: null }
    await migrateAuth(sql, settings)
    const auth = makeAuth(
      { dialect: new ActorSqliteDialect(sql), type: 'sqlite', transaction: true } as never,
      settings,
    )
    const seen: string[] = []
    const gateway = authGateway(
      {
        auth: (wire: WireRequest) => {
          seen.push(wire.headers.find(([name]) => name === CLIENT_IP_HEADER)?.[1] ?? '')
          return handleAuthRequest(auth, wire)
        },
        verifyToken: async () => null,
        user: async () => null,
      },
      TEST_URL,
      trustedProxies,
    )
    const askForCode = (peer: string, headers: Record<string, string> = {}) =>
      gateway.forward(
        new Request(`${TEST_URL}/api/auth/email-otp/send-verification-otp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: TEST_URL, ...headers },
          body: JSON.stringify({ email: 'someone@example.test', type: 'sign-in' }),
        }),
        peer,
      )
    return { askForCode, seen }
  }

  test('count per client: one that made up its address is still stopped, and doesn’t stop anyone else', async () => {
    const { askForCode, seen } = await limited()
    let status = 200
    let tries = 0
    // a different made-up address each time, as someone dodging the limit would send
    while (status === 200 && tries < 50) {
      tries++
      status = (
        await askForCode('203.0.113.7', {
          'x-forwarded-for': `198.51.100.${tries}`,
          [CLIENT_IP_HEADER]: `9.9.9.${tries}`,
        })
      ).status
    }
    expect(status).toBe(429)
    // Better Auth only ever heard the real address
    expect(new Set(seen)).toEqual(new Set(['203.0.113.7']))
    expect((await askForCode('203.0.113.8')).status).toBe(200)
  })

  test('behind a trusted proxy, clients are told apart by what the proxy says', async () => {
    const { askForCode } = await limited(PROXIES)
    let status = 200
    for (let i = 0; i < 50 && status === 200; i++) {
      status = (await askForCode('10.0.0.5', { 'x-forwarded-for': '203.0.113.7' })).status
    }
    expect(status).toBe(429)
    expect((await askForCode('10.0.0.5', { 'x-forwarded-for': '203.0.113.8' })).status).toBe(200)
  })
})
