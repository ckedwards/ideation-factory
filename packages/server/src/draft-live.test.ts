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

/** A draft socket on an idea: its messages as they come, and how it closed. */
function connect(idea: string, token: string) {
  const ws = new WebSocket(`ws://localhost:${server.port}/api/ideas/${idea}/draft/live`)
  const messages: DraftLiveEvent[] = []
  const waiting: (() => void)[] = []
  ws.onmessage = (event) => {
    messages.push(JSON.parse(String(event.data)) as DraftLiveEvent)
    waiting.splice(0).forEach((wake) => wake())
  }
  const closed = new Promise<number>((resolve) => (ws.onclose = (event) => resolve(event.code)))
  ws.onopen = () => ws.send(JSON.stringify({ type: 'token', token }))
  const next = async <T extends DraftLiveEvent['type']>(type: T): Promise<Extract<DraftLiveEvent, { type: T }>> => {
    for (;;) {
      const found = messages.find((m) => m.type === type)
      if (found) {
        messages.splice(messages.indexOf(found), 1)
        return found as Extract<DraftLiveEvent, { type: T }>
      }
      await new Promise<void>((wake) => waiting.push(wake))
    }
  }
  const send = (message: unknown) => ws.send(JSON.stringify(message))
  return { ws, next, send, closed }
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
  editing.send({ type: 'token', token: sam.jwt })
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
