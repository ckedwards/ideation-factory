// An idea's live socket, end to end: a real WebSocket to a Bun server in
// front of the app and the actors, with tokens from signing in.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createApiClient, LIVE_CLOSE, type LiveEvent } from '@ideaf/api'
import type { Server } from 'bun'
import { DIRECTORY_KEY } from './actors/directory.ts'
import { createApp } from './app.ts'
import { authGateway } from './auth/gateway.ts'
import { createLive, type LiveData } from './live.ts'
import { signIn, startTestActors, TEST_URL, testAuth } from './testing.ts'

let app: ReturnType<typeof createApp>
let server: Server<LiveData>

beforeAll(async () => {
  const actors = await startTestActors()
  app = createApp({ actors, auth: testAuth })
  const live = createLive({ actors, gateway: authGateway(actors.directory.getOrCreate(DIRECTORY_KEY), TEST_URL) })
  server = Bun.serve<LiveData>({
    port: 0,
    fetch: (request, s) => live.upgrade(request, s) ?? app(request),
    websocket: live.websocket,
  })
}, 60_000)
afterAll(() => server?.stop(true))

const name = (handle: string) => `${handle}-${crypto.randomUUID().slice(0, 6)}`
const client = (jwt: string) => createApiClient({ baseUrl: TEST_URL, token: jwt, fetch: (r) => app(r) })

/** A socket on an idea: its messages as they come, and how it closed. */
function connect(idea: string, token: string) {
  const ws = new WebSocket(`ws://localhost:${server.port}/api/ideas/${idea}/live`)
  const messages: LiveEvent[] = []
  const waiting: (() => void)[] = []
  ws.onmessage = (event) => {
    messages.push(JSON.parse(String(event.data)) as LiveEvent)
    waiting.splice(0).forEach((wake) => wake())
  }
  const closed = new Promise<number>((resolve) => (ws.onclose = (event) => resolve(event.code)))
  ws.onopen = () => ws.send(JSON.stringify({ type: 'token', token }))
  const next = async (type: LiveEvent['type']): Promise<LiveEvent> => {
    for (;;) {
      const found = messages.find((m) => m.type === type)
      if (found) {
        messages.splice(messages.indexOf(found), 1)
        return found
      }
      await new Promise<void>((wake) => waiting.push(wake))
    }
  }
  return { ws, next, closed }
}

test("comments, replies and resolving reach everyone viewing, as they'd be listed", async () => {
  const riley = await signIn(app, name('riley'))
  const api = client(riley.jwt)
  const { idea } = await api.createIdea({
    title: 'Live',
    files: [{ path: 'plan.md', content: '# Plan\n\nShip it.\n' }],
  })
  const viewer = connect(idea, riley.jwt)
  await viewer.next('ready')

  const { comment } = await api.addComment({
    idea,
    version: 1,
    anchor: { kind: 'text', file: 'f1', start: 5, end: 12 },
    body: 'When?',
  })
  const added = await viewer.next('comment')
  const [listed] = await api.listComments({ idea })
  // the same thread list_comments gives, so a viewer adds it as it is
  expect(added).toEqual({ type: 'comment', thread: listed!, by: { user: riley.id, bot: null, purpose: 'me' } })

  await api.reply({ idea, comment, body: 'Friday.' })
  expect(await viewer.next('reply')).toMatchObject({ parent: comment, reply: { body: 'Friday.', version: 1 } })
  await api.resolveComment({ idea, comment, resolved: true })
  expect(await viewer.next('resolved')).toMatchObject({ comment, resolved: true })
  viewer.ws.close()
}, 30_000)

test("no valid token, or an idea you can't see: the socket closes, saying which", async () => {
  const riley = await signIn(app, name('riley'))
  const outsider = await signIn(app, name('sam'))
  const { idea } = await client(riley.jwt).createIdea({
    title: 'Private',
    files: [{ path: 'plan.md', content: '# Plan\n' }],
  })
  expect(await connect(idea, 'not-a-token').closed).toBe(LIVE_CLOSE.unauthorized)
  expect(await connect(idea, outsider.jwt).closed).toBe(LIVE_CLOSE.notFound)
  expect(await connect('i-nothing-here', riley.jwt).closed).toBe(LIVE_CLOSE.notFound)
}, 30_000)

test('a fresh token keeps the socket open; one for someone else closes it', async () => {
  const riley = await signIn(app, name('riley'))
  const sam = await signIn(app, name('sam'))
  const { idea } = await client(riley.jwt).createIdea({ title: 'Kept', files: [{ path: 'plan.md', content: '# A\n' }] })
  const viewer = connect(idea, riley.jwt)
  await viewer.next('ready')
  viewer.ws.send(JSON.stringify({ type: 'token', token: riley.jwt }))
  viewer.ws.send(JSON.stringify({ type: 'token', token: sam.jwt }))
  expect(await viewer.closed).toBe(LIVE_CLOSE.unauthorized)
}, 30_000)

test('a plain request to the socket says to use a WebSocket', async () => {
  const response = await fetch(`http://localhost:${server.port}/api/ideas/i1/live`)
  expect(response.status).toBe(426)
})
