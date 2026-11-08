// "Define each operation once" end to end: the typed client from @ideaf/api,
// calling the server's routes (built from the same definitions) in memory,
// against real idea actors on RivetKit's local engine. Every response is
// checked against its published schema.
import { beforeAll, expect, test } from 'bun:test'
import { ApiError, createApiClient } from '@ideaf/api'
import { contentHash } from '@ideaf/core'
import { createApp } from './app.ts'
import { ideaIdFor } from './operations.ts'
import { signIn, startTestActors, TEST_URL, testAuth } from './testing.ts'

let app: (request: Request) => Promise<Response>

beforeAll(async () => {
  app = createApp({ actors: await startTestActors(), auth: testAuth, validateOutput: true })
}, 60_000)

const someone = `ops-${crypto.randomUUID().slice(0, 6)}`
const client = () =>
  createApiClient({
    baseUrl: TEST_URL,
    token: async () => (await signIn(app, someone)).jwt,
    fetch: (r) => app(r),
    validateOutput: true,
  })
const PLAN = '# Plan\n\nThe quick brown fox.\n\n## Risks\n\nIt might rain.\n'

test('the agent loop: create, show blocks, comment, dry run, edit, pull, sync', async () => {
  const api = client()
  const { idea, version } = await api.createIdea({ title: 'Plan', files: [{ path: 'plan.md', content: PLAN }] })
  expect(version).toBe(1)

  // read the structured view, and comment on a block's text
  const blocks = await api.showBlocks({ idea })
  expect(blocks.files[0]!.entries.map((e) => [e.id, e.kind])).toEqual([
    ['s2', 'heading'],
    ['b3', 'paragraph'],
    ['s4', 'heading'],
    ['b5', 'paragraph'],
  ])
  const { comment } = await api.addComment({
    idea,
    version: 1,
    anchor: { kind: 'text', file: 'f1', start: 15, end: 20 },
    body: 'Which brown?',
  })
  expect((await api.showBlocks({ idea })).comments.map((c) => [c.id, c.anchor])).toEqual([
    [comment, { kind: 'text', file: 'f1', start: 15, end: 20, quote: 'brown' }],
  ])

  // plan an edit that addresses the comment; dry-run it, then apply it
  const batch = {
    base: 1,
    steps: [{ command: 'replace' as const, in: 'b3', old: 'brown', new: 'red', addresses: [comment] }],
  }
  const preview = await api.previewEdit({ idea, batch })
  expect(preview.files).toEqual([{ file: 'f1', path: 'plan.md', before: PLAN, content: PLAN.replace('brown', 'red') }])
  expect(preview.comments).toEqual([
    { id: comment, state: 'changed', anchor: { kind: 'text', file: 'f1', start: 15, end: 18, quote: 'red' } },
  ])
  const edited = await api.edit({ idea, batch })
  expect(edited.version).toBe(2)
  const [thread] = await api.listComments({ idea })
  expect(thread).toMatchObject({ id: comment, state: 'changed', addressedIn: [2] })

  // pull the result, edit it locally, and sync it back with its base
  const pulled = await api.pull({ idea })
  expect(pulled).toEqual({
    version: 2,
    files: [
      {
        file: 'f1',
        path: 'plan.md',
        hash: await contentHash(PLAN.replace('brown', 'red')),
        content: PLAN.replace('brown', 'red'),
      },
    ],
  })
  const local = pulled.files[0]!
  const synced = await api.sync({
    idea,
    files: [{ file: local.file, path: local.path, content: `${local.content}\nMore.\n`, base: local.hash }],
  })
  expect(synced.version).toBe(3)
  expect((await api.getIdea({ idea })).versions.map((v) => v.how)).toEqual(['created', 'commands', 'upload'])
  // someone's own idea: in no team, found at @ and their handle
  expect(await api.getIdea({ idea })).toMatchObject({ team: null, place: `@${someone}`, you: { owner: true } })
  const { number } = await api.getIdea({ idea })
  expect(await api.findIdea({ place: `@${someone}`, number })).toEqual({ id: idea, place: `@${someone}`, number })

  // replies and resolving
  await api.reply({ idea, comment, body: 'Red it is.' })
  await api.resolveComment({ idea, comment, resolved: true })
  expect((await api.listComments({ idea }))[0]).toMatchObject({ resolved: true, replies: [{ body: 'Red it is.' }] })
  expect((await api.showBlocks({ idea })).comments).toEqual([])
})

test('errors come back as ApiError with their codes and details', async () => {
  const api = client()
  const { idea } = await api.createIdea({ title: 'Errors', files: [{ path: 'a.md', content: PLAN }] })
  const pulled = await api.pull({ idea })
  await api.edit({ idea, batch: { base: 1, steps: [{ command: 'replace', in: 'b5', old: 'rain', new: 'snow' }] } })

  // syncing from a stale base: pull first
  const stale = await api
    .sync({
      idea,
      files: [{ file: 'f1', path: 'a.md', content: PLAN.replace('fox', 'cat'), base: pulled.files[0]!.hash }],
    })
    .catch((e: unknown) => e)
  expect(stale).toBeInstanceOf(ApiError)
  expect(stale).toMatchObject({ code: 'pull_first', status: 409, details: { latest: 2, files: [{ file: 'f1' }] } })

  // a batch that no longer applies: conflict, naming the step
  const conflict = await api
    .edit({ idea, batch: { base: 1, steps: [{ command: 'replace', in: 'b5', old: 'rain', new: 'hail' }] } })
    .catch((e: unknown) => e)
  expect(conflict).toMatchObject({
    code: 'conflict',
    status: 409,
    details: { conflicts: [{ step: 0, reason: 'no_match' }] },
  })

  // a malformed batch never leaves the client
  await expect(api.edit({ idea, batch: { base: 1, steps: [] } })).rejects.toMatchObject({ code: 'invalid', status: 0 })
  // an unknown idea, and a missing version
  await expect(api.getIdea({ idea: 'nope' })).rejects.toMatchObject({ code: 'not_found', status: 404 })
  await expect(api.pull({ idea, version: 99 })).rejects.toMatchObject({ code: 'not_found', status: 404 })
  // the wrong token
  const outsider = createApiClient({ baseUrl: TEST_URL, token: 'wrong', fetch: (r) => app(r) })
  await expect(outsider.getIdea({ idea })).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
})

test('a retried create finds the same idea instead of making another', async () => {
  const api = client()
  const key = crypto.randomUUID()
  const first = await api.createIdea(
    { title: 'Once', files: [{ path: 'a.md', content: '# A\n' }] },
    { idempotencyKey: key },
  )
  const again = await api.createIdea(
    { title: 'Once', files: [{ path: 'a.md', content: '# A\n' }] },
    { idempotencyKey: key },
  )
  expect(again).toEqual(first)
  const { id } = await signIn(app, someone)
  expect(first.idea).toBe(await ideaIdFor({ user: id, bot: null, purpose: 'me' }, key))
})

test("the API is under /api; every other path is the web app's", async () => {
  const withWeb = createApp({
    actors: await startTestActors(),
    auth: testAuth,
    web: async () => new Response('the app'),
  })
  expect(await (await withWeb(new Request(`${TEST_URL}/teams/mobile`))).text()).toBe('the app')
  const missing = await withWeb(new Request(`${TEST_URL}/api/nothing-here`))
  expect(missing.status).toBe(404)
  expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } })
  // without the web app, a page's path is just not found
  expect((await app(new Request(`${TEST_URL}/teams/mobile`))).status).toBe(404)
})

test('get_people names several people in one call, leaving out anyone not found', async () => {
  const api = client()
  const me = await api.me({})
  const other = await signIn(app, `${someone}-other`)
  const { items } = await api.getPeople({ ids: [me.id, other.id, 'u-nobody'] })
  expect(items.map((p) => p.id).sort()).toEqual([me.id, other.id].sort())
  await expect(api.getPeople({ ids: [] })).rejects.toMatchObject({ code: 'invalid' })
})

test('/api/openapi.json and /health need no token', async () => {
  const openapi = await (await app(new Request(`${TEST_URL}/api/openapi.json`))).json()
  expect(openapi).toMatchObject({
    openapi: '3.1.0',
    paths: { '/ideas/{idea}/edits': { post: { operationId: 'edit' } } },
  })
  expect(await (await app(new Request(`${TEST_URL}/health`))).json()).toEqual({ ok: true })
})
