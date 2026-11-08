// The keys access tokens are signed with: rotated on a schedule or on demand,
// and withdrawn in an emergency. On a Better Auth of its own (bun:sqlite), so
// withdrawing every key doesn't touch the other tests' tokens.
import { beforeEach, describe, expect, test } from 'bun:test'
import { createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet, jwtVerify } from 'jose'
import { bunSql } from '../sql/sql-bun.ts'
import { TEST_URL, testAuth } from '../testing.ts'
import { type Auth, makeAuth, SIGNING_KEY_ROTATION_SECONDS } from './config.ts'
import { ActorSqliteDialect } from './dialect.ts'
import { migrateAuth, rotateSigningKeys } from './in-directory.ts'

let auth: Auth
beforeEach(async () => {
  const sql = bunSql()
  await migrateAuth(sql, testAuth)
  auth = makeAuth({ dialect: new ActorSqliteDialect(sql), type: 'sqlite', transaction: true } as never, testAuth)
})

const sign = async () => ((await auth.api.signJWT({ body: { payload: { sub: 'u1' } } })) as { token: string }).token
const kid = (token: string) => decodeProtectedHeader(token).kid
const published = async () => (await auth.api.getJwks()) as JSONWebKeySet
const verifies = async (token: string) =>
  jwtVerify(token, createLocalJWKSet(await published()), { issuer: TEST_URL }).then(
    () => true,
    () => false,
  )
const keys = async () =>
  (await (await auth.$context).adapter.findMany({ model: 'jwks' })) as Array<{
    id: string
    createdAt: Date
    expiresAt: Date | null
  }>

describe('signing keys', () => {
  test('a key signs until it expires, then the next token gets a new one; the old one stays published', async () => {
    const first = await sign()
    expect(kid(await sign())).toBe(kid(first))
    const [key] = await keys()
    // it expires after the rotation interval (Better Auth reads the clock twice, so allow a few ms)
    const lifetime = new Date(key!.expiresAt!).getTime() - new Date(key!.createdAt).getTime()
    expect(Math.abs(lifetime - SIGNING_KEY_ROTATION_SECONDS * 1000)).toBeLessThan(10)
    // as if 30 days went by
    await (
      await auth.$context
    ).adapter.update({
      model: 'jwks',
      where: [{ field: 'id', value: key!.id }],
      update: { expiresAt: new Date(Date.now() - 1000) },
    })
    const second = await sign()
    expect(kid(second)).not.toBe(kid(first))
    expect((await published()).keys.map((k) => k.kid).sort()).toEqual([kid(first), kid(second)].sort())
    expect(await verifies(first)).toBe(true)
    expect(await verifies(second)).toBe(true)
  })

  test('a routine rotation replaces the key now, and tokens it signed keep working', async () => {
    const before = await sign()
    expect(await rotateSigningKeys(auth, false)).toEqual({ retired: 1 })
    const after = await sign()
    expect(kid(after)).not.toBe(kid(before))
    expect(await verifies(before)).toBe(true)
    expect(await verifies(after)).toBe(true)
  })

  test('an emergency rotation withdraws every key: tokens out there stop verifying, new ones work', async () => {
    const old = await sign()
    await rotateSigningKeys(auth, false)
    const recent = await sign()
    expect(await rotateSigningKeys(auth, true)).toEqual({ retired: 2 })
    expect(await verifies(old)).toBe(false)
    expect(await verifies(recent)).toBe(false)
    const fresh = await sign()
    expect(await verifies(fresh)).toBe(true)
    expect((await published()).keys.map((k) => k.kid)).toEqual([kid(fresh)])
  })
})
