// The draft's live socket, end to end: real WebSockets to a Bun server in front of the app and the
// actors, with tokens from signing in, typing as the page editor types (its document, its steps).
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createApiClient, DRAFT_LIVE_CLOSE, type DraftLiveEvent } from '@ideaf/api'
import { type Node, pageDocument, type Schema, Step, Transform } from '@ideaf/ui/editor/model'
import type { Server } from 'bun'
import { DIRECTORY_KEY } from './actors/directory.ts'
import { createApp } from './app.ts'
import { authGateway } from './auth/gateway.ts'
import { createDraftLive, type DraftLiveData } from './draft-live.ts'
import { signIn, startTestActors, TEST_URL, testAuth } from './testing.ts'

let app: ReturnType<typeof createApp>
let server: Server<DraftLiveData>
let schema: Schema

beforeAll(async () => {
  const actors = await startTestActors()
  app = createApp({ actors, auth: testAuth })
  const live = createDraftLive({
    actors,
    gateway: authGateway(actors.directory.getOrCreate(DIRECTORY_KEY), TEST_URL),
    // two windows to a draft, so the third reads along
    limits: { editors: 2, caretMs: 80 },
  })
  server = Bun.serve<DraftLiveData>({
    port: 0,
    fetch: (request, s) => live.upgrade(request, s) ?? app(request),
    websocket: live.websocket,
  })
  schema = (await pageDocument('', [])).schema
}, 60_000)
afterAll(() => server?.stop(true))

const name = (handle: string) => `${handle}-${crypto.randomUUID().slice(0, 6)}`
const client = (jwt: string) => createApiClient({ baseUrl: TEST_URL, token: jwt, fetch: (r) => app(r) })
const PLAN = '# Plan\n\nShip it.\n'

/** A draft socket on an idea, as one browser window: its messages as they come, and how it closed. */
function connect(idea: string, token: string, window = `window-${crypto.randomUUID()}`) {
  const ws = new WebSocket(`ws://localhost:${server.port}/api/ideas/${idea}/draft/live`)
  const messages: DraftLiveEvent[] = []
  const waiting: (() => void)[] = []
  ws.onmessage = (event) => {
    messages.push(JSON.parse(String(event.data)) as DraftLiveEvent)
    waiting.splice(0).forEach((wake) => wake())
  }
  const closed = new Promise<number>((resolve) => (ws.onclose = (event) => resolve(event.code)))
  ws.onopen = () => ws.send(JSON.stringify({ type: 'token', token, window }))
  const next = async <T extends DraftLiveEvent['type']>(
    type: T,
    where: (event: Extract<DraftLiveEvent, { type: T }>) => boolean = () => true,
  ): Promise<Extract<DraftLiveEvent, { type: T }>> => {
    for (;;) {
      const found = messages.find((m) => m.type === type && where(m as Extract<DraftLiveEvent, { type: T }>))
      if (found) {
        messages.splice(messages.indexOf(found), 1)
        return found as Extract<DraftLiveEvent, { type: T }>
      }
      await new Promise<void>((wake) => waiting.push(wake))
    }
  }
  const send = (message: unknown) => ws.send(JSON.stringify(message))
  return { ws, next, send, closed, window, messages }
}

/** Steps that type `text` at `at` in `doc`, as JSON. */
function typing(doc: Node, at: number, text: string): unknown[] {
  return new Transform(doc).insert(at, schema.text(text)).steps.map((s) => s.toJSON())
}

const apply = (doc: Node, steps: unknown[]) =>
  steps.reduce<Node>((d, json) => Step.fromJSON(schema, json).apply(d).doc!, doc)

test('typing reaches everyone editing the file, stored, each step with whose it is', async () => {
  const riley = await signIn(app, name('riley'))
  const { idea } = await client(riley.jwt).createIdea({ title: 'Live', files: [{ path: 'plan.md', content: PLAN }] })
  const ana = connect(idea, riley.jwt)
  const raj = connect(idea, riley.jwt)
  await ana.next('ready')
  await raj.next('ready')
  ana.send({ type: 'open', file: 'f1' })
  raj.send({ type: 'open', file: 'f1' })
  const opened = await ana.next('opened')
  expect(opened).toMatchObject({ file: 'f1', version: 0 })
  await raj.next('opened')
  const doc = schema.nodeFromJSON(opened.doc)
  // "Ship it." is the paragraph after the heading (6): its text starts at 7
  ana.send({ type: 'steps', file: 'f1', version: 0, steps: typing(doc, 15, ' Soon.'), client: 'ana' })
  const mine = await ana.next('steps')
  const theirs = await raj.next('steps')
  expect(mine).toEqual(theirs)
  expect(mine).toMatchObject({ file: 'f1', from: 0, clients: ['ana'] })
  expect(apply(doc, mine.steps).child(1).textContent).toBe('Ship it. Soon.')
  // Raj typed on the old count: behind, and what he missed is there to take
  raj.send({ type: 'steps', file: 'f1', version: 0, steps: typing(doc, 7, 'Now: '), client: 'raj' })
  expect(await raj.next('behind')).toEqual({ type: 'behind', file: 'f1', version: 1 })
  raj.send({ type: 'since', file: 'f1', version: 0 })
  expect(await raj.next('steps')).toMatchObject({ from: 0, clients: ['ana'] })
  // the draft is the typing, by whoever typed it
  const draft = await client(riley.jwt).getDraft({ idea })
  expect(draft.files[0]!.content).toBe('# Plan\n\nShip it. Soon.\n')
  expect(draft.changes).toMatchObject([{ key: 'e-b3', by: { user: riley.id } }])
  ana.ws.close()
  raj.ws.close()
}, 30_000)

test('a commit is announced after the steps that move the documents onto it', async () => {
  const riley = await signIn(app, name('riley'))
  const api = client(riley.jwt)
  const { idea } = await api.createIdea({ title: 'Commit', files: [{ path: 'plan.md', content: PLAN }] })
  const ana = connect(idea, riley.jwt)
  await ana.next('ready')
  ana.send({ type: 'open', file: 'f1' })
  const doc = schema.nodeFromJSON((await ana.next('opened')).doc)
  ana.send({ type: 'steps', file: 'f1', version: 0, steps: typing(doc, 15, ' Soon.'), client: 'ana' })
  await ana.next('steps')
  await api.commitDraft({ idea })
  expect(await ana.next('version')).toMatchObject({ version: 2, by: { user: riley.id } })
  // typing goes on, on the same count: the documents are the new version's
  ana.send({ type: 'steps', file: 'f1', version: 1, steps: typing(apply(doc, []), 7, 'Now: '), client: 'ana' })
  expect(await ana.next('steps')).toMatchObject({ from: 1, clients: ['ana'] })
  ana.ws.close()
}, 30_000)

test('someone who can only view the idea, or nobody, is closed out', async () => {
  const riley = await signIn(app, name('riley'))
  const sam = await signIn(app, name('sam'))
  const api = client(riley.jwt)
  const { idea } = await api.createIdea({ title: 'Viewed', files: [{ path: 'plan.md', content: PLAN }] })
  await api.setAccess({ idea, subject: { kind: 'user', id: sam.id }, access: { edit: false, share: false } })
  expect(await connect(idea, sam.jwt).closed).toBe(DRAFT_LIVE_CLOSE.forbidden)
  expect(await connect(idea, 'not-a-token').closed).toBe(DRAFT_LIVE_CLOSE.unauthorized)
  // given edit access, then losing it: the next token closes the socket
  await api.setAccess({ idea, subject: { kind: 'user', id: sam.id }, access: { edit: true, share: false } })
  const editing = connect(idea, sam.jwt)
  await editing.next('ready')
  await api.setAccess({ idea, subject: { kind: 'user', id: sam.id }, access: null })
  editing.send({ type: 'token', token: sam.jwt, window: editing.window })
  expect(await editing.closed).toBe(DRAFT_LIVE_CLOSE.notFound)
}, 30_000)

test('a paste larger than one RivetKit message is taken whole', async () => {
  const riley = await signIn(app, name('riley'))
  const { idea } = await client(riley.jwt).createIdea({ title: 'Paste', files: [{ path: 'plan.md', content: PLAN }] })
  const ana = connect(idea, riley.jwt)
  await ana.next('ready')
  ana.send({ type: 'open', file: 'f1' })
  const doc = schema.nodeFromJSON((await ana.next('opened')).doc)
  // one step of about 90 KB: past RivetKit's 64 KiB default, as a large paste is
  const words = 'Pasted words, many of them. '.repeat(3300)
  const steps = typing(doc, 15, ` ${words}`)
  expect(JSON.stringify(steps).length).toBeGreaterThan(64 * 1024)
  ana.send({ type: 'steps', file: 'f1', version: 0, steps, client: 'ana' })
  expect(await ana.next('steps')).toMatchObject({ from: 0, clients: ['ana'] })
  const draft = await client(riley.jwt).getDraft({ idea })
  expect(draft.files[0]!.content.length).toBeGreaterThan(90_000)
  ana.ws.close()
}, 30_000)

test('words seen moved between paragraphs are counted as a move', async () => {
  const riley = await signIn(app, name('riley'))
  const api = client(riley.jwt)
  const { idea } = await api.createIdea({
    title: 'Moved',
    files: [{ path: 'plan.md', content: '# Plan\n\nShip it now.\n\nThen rest.\n' }],
  })
  const ana = connect(idea, riley.jwt)
  await ana.next('ready')
  ana.send({ type: 'open', file: 'f1' })
  let doc = schema.nodeFromJSON((await ana.next('opened')).doc)
  // " now" cut from the first paragraph (its text is 7 to 19), and pasted after "Then rest."
  const cut = new Transform(doc).delete(14, 18).steps.map((s) => s.toJSON())
  ana.send({ type: 'steps', file: 'f1', version: 0, steps: cut, client: 'ana' })
  doc = apply(doc, (await ana.next('steps')).steps)
  ana.send({ type: 'steps', file: 'f1', version: 1, steps: typing(doc, 27, ' now'), client: 'ana' })
  await ana.next('steps')
  ana.send({ type: 'moved', file: 'f1', words: { from: 'b3', old: ' now', to: { in: 'b4', after: 'Then rest.' } } })
  let changes: Awaited<ReturnType<typeof api.getDraft>>['changes'] = []
  for (let i = 0; i < 50 && !changes.some((c) => c.change.kind === 'move-text'); i++) {
    await Bun.sleep(100)
    changes = (await api.getDraft({ idea })).changes
  }
  expect(changes).toMatchObject([{ change: { kind: 'move-text', from: 'b3', old: ' now' } }])
  ana.ws.close()
}, 30_000)

test('each window sees where the others are, and when they leave', async () => {
  const riley = await signIn(app, name('riley'))
  const { idea } = await client(riley.jwt).createIdea({ title: 'Carets', files: [{ path: 'plan.md', content: PLAN }] })
  const first = connect(idea, riley.jwt)
  const ready = await first.next('ready')
  expect(ready).toMatchObject({ joined: true, limit: 2, caretMs: 80 })
  expect(ready.people).toEqual([{ window: first.window, user: riley.id, color: 1, at: null }])
  // the same person in a second window: another entity, in another color
  const second = connect(idea, riley.jwt)
  expect((await second.next('ready')).people.map((p) => [p.window, p.color])).toEqual([
    [first.window, 1],
    [second.window, 2],
  ])
  // each window hears its own arrival too; the page leaves its own out
  expect(await first.next('presence', (e) => e.person.window === second.window)).toEqual({
    type: 'presence',
    person: { window: second.window, user: riley.id, color: 2, at: null },
  })
  const at = { file: 'f1', anchor: 9, head: 12, version: 0 }
  second.send({ type: 'here', at })
  expect((await first.next('presence', (e) => e.person.at !== null)).person).toEqual({
    window: second.window,
    user: riley.id,
    color: 2,
    at,
  })
  second.ws.close()
  expect(await first.next('left')).toEqual({ type: 'left', window: second.window })
  first.ws.close()
}, 30_000)

test('past the limit a window reads along, and joins when someone leaves', async () => {
  const riley = await signIn(app, name('riley'))
  const { idea } = await client(riley.jwt).createIdea({ title: 'Full', files: [{ path: 'plan.md', content: PLAN }] })
  const a = connect(idea, riley.jwt)
  await a.next('ready')
  const b = connect(idea, riley.jwt)
  await b.next('ready')
  const c = connect(idea, riley.jwt)
  const ready = await c.next('ready')
  expect(ready).toMatchObject({ joined: false, limit: 2 })
  expect(ready.people.map((p) => p.window)).toEqual([a.window, b.window])
  // it opens the file and takes everyone's typing, but can't type
  c.send({ type: 'open', file: 'f1' })
  const doc = schema.nodeFromJSON((await c.next('opened')).doc)
  a.send({ type: 'open', file: 'f1' })
  await a.next('opened')
  a.send({ type: 'steps', file: 'f1', version: 0, steps: typing(doc, 15, ' Soon.'), client: 'a' })
  expect(await c.next('steps')).toMatchObject({ from: 0, clients: ['a'] })
  c.send({ type: 'steps', file: 'f1', version: 1, steps: typing(apply(doc, []), 7, 'Now: '), client: 'c' })
  expect(await c.next('refused')).toMatchObject({ file: 'f1', message: expect.stringContaining('full') })
  // its caret isn't shown either
  c.send({ type: 'here', at: { file: 'f1', anchor: 7, head: 7, version: 1 } })
  b.ws.close()
  expect(await c.next('joined')).toMatchObject({ people: [{ window: a.window }, { window: c.window }] })
  expect(await a.next('left')).toEqual({ type: 'left', window: b.window })
  expect((await a.next('presence', (e) => e.person.window === c.window)).person).toMatchObject({ color: 2, at: null })
  a.ws.close()
  c.ws.close()
}, 30_000)

test('a window back on a new socket keeps its place; the old one closing late leaves it in', async () => {
  const riley = await signIn(app, name('riley'))
  const { idea } = await client(riley.jwt).createIdea({ title: 'Back', files: [{ path: 'plan.md', content: PLAN }] })
  const watcher = connect(idea, riley.jwt)
  await watcher.next('ready')
  const old = connect(idea, riley.jwt)
  await old.next('ready')
  const fresh = connect(idea, riley.jwt, old.window)
  expect((await fresh.next('ready')).people.map((p) => [p.window, p.color])).toEqual([
    [watcher.window, 1],
    [old.window, 2],
  ])
  old.ws.close()
  await old.closed
  fresh.send({ type: 'here', at: { file: 'f1', anchor: 7, head: 7, version: 0 } })
  // the watcher hears the caret, and never that the window left
  await watcher.next('presence', (e) => e.person.at?.anchor === 7)
  expect(watcher.messages.some((m) => m.type === 'left')).toBe(false)
  watcher.ws.close()
  fresh.ws.close()
}, 30_000)
