import { afterAll, describe, expect, test } from 'bun:test'
import { ensurePools } from './engine-pools.ts'

// a stand-in for the engine's API: refuses the first few requests, as a starting engine does
const requests: { path: string; auth: string | null; body: string }[] = []
let refusals = 0
const engine = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    requests.push({
      path: url.pathname + url.search,
      auth: request.headers.get('authorization'),
      body: await request.text(),
    })
    if (request.headers.get('authorization') !== 'Bearer tok') {
      return new Response('unauthorized', { status: 401 })
    }
    if (refusals > 0) {
      refusals--
      return new Response('depot.overloaded', { status: 503 })
    }
    return Response.json({})
  },
})
afterAll(() => engine.stop(true))
const at = (token: string) => `http://default:${token}@127.0.0.1:${engine.port}`

describe("the engine's node pools", () => {
  test('each made once, draining old versions, with the admin token', async () => {
    requests.length = 0
    await ensurePools(at('tok'), ['default', 'directory', 'default'])
    expect(requests).toEqual([
      { path: '/pools/default?namespace=default', auth: 'Bearer tok', body: '{"drain_on_version_upgrade":true}' },
      { path: '/pools/directory?namespace=default', auth: 'Bearer tok', body: '{"drain_on_version_upgrade":true}' },
    ])
  })

  test('waits for an engine that is still starting', async () => {
    requests.length = 0
    refusals = 2
    await ensurePools(at('tok'), ['default'], { retryMs: 10 })
    expect(requests).toHaveLength(3)
  })

  test('stops at once on a refused token, and gives up on an engine that never answers', async () => {
    requests.length = 0
    await expect(ensurePools(at('wrong'), ['default'], { retryMs: 10 })).rejects.toThrow('refused the admin token')
    expect(requests).toHaveLength(1)
    await expect(
      ensurePools('http://default:tok@127.0.0.1:1', ['default'], { timeoutMs: 50, retryMs: 10 }),
    ).rejects.toThrow("couldn't make the engine's default pool")
    await expect(ensurePools(`http://127.0.0.1:${engine.port}`, ['default'])).rejects.toThrow('no admin token')
  })
})
