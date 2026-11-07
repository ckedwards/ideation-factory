// The idea actor through RivetKit's local engine (started on first use and
// shared with `bun run dev`), so each test uses its own idea key.
import { beforeAll, expect, test } from 'bun:test'
import type { Client } from 'rivetkit/client'
import type { Caller } from '../idea/service.ts'
import type { Registry } from '../registry.ts'
import { startTestActors } from '../testing.ts'

const OWNER: Caller = { user: 'dev', bot: null, purpose: 'me' }
const PLAN = '# Plan\n\nThe quick brown fox.\n'
let actors: Client<Registry>

beforeAll(async () => {
  actors = await startTestActors()
}, 60_000)

const key = () => `test-${crypto.randomUUID()}`
const send = (
  idea: ReturnType<Client<Registry>['idea']['getOrCreate']>,
  write: unknown,
  k: string = crypto.randomUUID(),
) => idea.send('writes', { key: k, caller: OWNER, write }, { wait: true, timeout: 20_000 })

test('create, edit and read through the actor, with live updates to a connected viewer', async () => {
  const idea = actors.idea.getOrCreate([key()])
  const viewer = idea.connect()
  const events: unknown[] = []
  viewer.on('version', (e) => events.push(e))
  viewer.on('comment', (e) => events.push(e))
  await new Promise((r) => setTimeout(r, 200))

  expect(await send(idea, { type: 'create', title: 'Plan', files: [{ path: 'plan.md', content: PLAN }] })).toEqual({
    status: 'completed',
    response: { ok: true, value: { kind: 'created', version: 1 } },
  })
  await send(idea, {
    type: 'comment',
    version: 1,
    anchor: { kind: 'text', file: 'f1', start: 15, end: 20 },
    body: 'Which brown?',
  })
  const edited = await send(idea, {
    type: 'edit',
    batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'brown', new: 'red' }] },
  })
  expect(edited.response).toMatchObject({
    ok: true,
    value: { version: 2, comments: [{ id: 'c1', state: 'changed', anchor: { quote: 'red' } }] },
  })

  expect((await idea.file(undefined, 'f1'))!.content).toBe('# Plan\n\nThe quick red fox.\n')
  expect((await idea.comments(1))[0]).toMatchObject({ state: 'exact', anchor: { quote: 'brown' } })
  expect((await idea.summary())!.versions.map((v) => v.how)).toEqual(['created', 'commands'])

  await new Promise((r) => setTimeout(r, 300))
  expect(events).toEqual([
    { version: 1, how: 'created', by: OWNER },
    {
      thread: expect.objectContaining({
        id: 'c1',
        body: 'Which brown?',
        state: 'exact',
        anchor: expect.objectContaining({ quote: 'brown' }),
      }),
      by: OWNER,
    },
    { version: 2, how: 'commands', by: OWNER },
  ])
  await viewer.dispose()
})

test('concurrent batches on one idea are applied in order, each against the latest version', async () => {
  const idea = actors.idea.getOrCreate([key()])
  await send(idea, { type: 'create', title: 'List', files: [{ path: 'list.md', content: '# List\n' }] })
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      send(idea, {
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: `Item ${i}.` }] },
      }),
    ),
  )
  const versions = results.map((r) =>
    r.response?.ok && r.response.value.kind === 'version' ? r.response.value.version : 0,
  )
  expect(versions.toSorted((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  const content = (await idea.file(undefined, 'f1'))!.content
  for (let i = 0; i < 10; i++) {
    expect(content).toContain(`Item ${i}.`)
  }
})

test('a retried write is applied once', async () => {
  const idea = actors.idea.getOrCreate([key()])
  await send(idea, { type: 'create', title: 'T', files: [{ path: 'a.md', content: '# A\n' }] })
  const write = {
    type: 'edit',
    batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'Once.' }] },
  }
  const first = await send(idea, write, 'retry-key')
  const second = await send(idea, write, 'retry-key')
  expect(second.response).toEqual(first.response!)
  expect((await idea.summary())!.latest).toBe(2)
})
