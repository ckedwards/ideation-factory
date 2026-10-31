// Runs the idea actor on RivetKit's local engine (started on first use and
// shared with `bun run dev`), so each test uses its own idea key.
import { beforeAll, describe, expect, test } from 'bun:test'
import { type Client, createClient } from 'rivetkit/client'
import { createApp } from './app.ts'
import { registry, type Registry } from './registry.ts'

let actors: Client<Registry>
beforeAll(async () => {
  registry.config.noWelcome = true
  await registry.startAndWait()
  actors = createClient<Registry>(registry.parseConfig().endpoint!)
}, 60_000)

const key = () => `test-${crypto.randomUUID()}`

describe('idea actor', () => {
  test('applies queued writes in the order they were sent', async () => {
    const idea = actors.idea.getOrCreate([key()])
    for (let i = 1; i < 20; i++) await idea.send('writes', { type: 'set-title', title: `Title ${i}` })
    const last = await idea.send('writes', { type: 'set-title', title: 'Title 20' }, { wait: true, timeout: 10_000 })
    expect(last).toEqual({ status: 'completed', response: { ok: true, writes: 20 } })
    expect(await idea.get()).toEqual({ title: 'Title 20', writes: 20 })
  })

  test('concurrent writes are each applied once', async () => {
    const idea = actors.idea.getOrCreate([key()])
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        idea.send('writes', { type: 'set-title', title: `Title ${i}` }, { wait: true, timeout: 10_000 }),
      ),
    )
    const counts = results.map((r) => (r.status === 'completed' && r.response?.ok ? r.response.writes : 0))
    expect(counts.toSorted((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
    expect((await idea.get()).writes).toBe(25)
  })

  test('a refused write changes nothing', async () => {
    const idea = actors.idea.getOrCreate([key()])
    const result = await idea.send('writes', { type: 'set-title', title: '   ' }, { wait: true, timeout: 10_000 })
    expect(result).toEqual({ status: 'completed', response: { ok: false, error: 'title_empty' } })
    expect(await idea.get()).toEqual({ title: null, writes: 0 })
  })
})

describe('HTTP routes', () => {
  test('set and read a title', async () => {
    const app = createApp({ actors })
    const id = key()
    const put = await app(new Request(`http://x/ideas/${id}/title`, { method: 'PUT', body: JSON.stringify({ title: 'An idea' }) }))
    expect(put.status).toBe(200)
    const get = await app(new Request(`http://x/ideas/${id}`))
    expect(await get.json()).toEqual({ title: 'An idea', writes: 1 })
  })

  test('health, bad input and unknown routes', async () => {
    const app = createApp({ actors })
    expect(await (await app(new Request('http://x/health'))).json()).toEqual({ ok: true })
    expect((await app(new Request(`http://x/ideas/${key()}/title`, { method: 'PUT', body: '{}' }))).status).toBe(400)
    expect((await app(new Request('http://x/nope'))).status).toBe(404)
  })
})
