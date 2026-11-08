/// <reference types="bun" />
// The comments collection against a stand-in socket and API: threads read
// once and kept live from events, and writes shown at once, then confirmed
// by their echo or taken back if refused.
import { expect, test } from 'bun:test'
import type { LiveEvent } from '@ideaf/api'
import { type CommentsDeps, commentsCollection, pendingId, type SocketLike } from './comments.ts'
import type { Thread } from './view.ts'

const riley = { user: 'u-riley', bot: null, purpose: 'me' as const }
const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  author: riley,
  createdAt: 1,
  body: `Comment ${id}`,
  version: 1,
  resolved: false,
  state: 'exact',
  anchor: { kind: 'text', file: 'f1', start: 0, end: 4, quote: 'Ship' },
  lastVersion: 1,
  addressedIn: [],
  suggestion: null,
  replies: [],
  ...extra,
})
const tick = () => new Promise((r) => setTimeout(r, 5))

function setup(
  listed: Thread[] = [thread('c1')],
  api: Partial<CommentsDeps['api']> = {},
  more: Partial<CommentsDeps> = {},
) {
  let server: Thread[] = listed
  const sockets: { sent: string[]; emit(event: LiveEvent): Promise<void> }[] = []
  const calls: string[] = []
  const deps: CommentsDeps = {
    api: {
      listComments: async () => {
        calls.push('list')
        return server
      },
      addComment: async () => ({ comment: 'c9' }),
      suggestEdit: async () => ({ comment: 'c9', old: 'Ship' }),
      reply: async () => ({ comment: 'c10' }),
      resolveComment: async (input) => ({ comment: input.comment, resolved: input.resolved }),
      rejectSuggestion: async (input) => ({ comment: input.comment }),
      ...api,
    },
    open: (path) => {
      calls.push(`open ${path}`)
      const socket = {
        sent: [] as string[],
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onclose: null as ((event: { code: number }) => void) | null,
        send(data: string) {
          this.sent.push(data)
        },
        close() {},
        async emit(event: LiveEvent) {
          await this.onmessage?.({ data: JSON.stringify(event) })
        },
      }
      sockets.push(socket)
      queueMicrotask(() => socket.onopen?.())
      // only what the sync uses: a stand-in, not a whole WebSocket
      return socket as unknown as SocketLike
    },
    token: async () => 'jwt',
    echoTimeoutMs: 50,
    ...more,
  }
  const comments = commentsCollection('i1', deps)
  const ready = async () => {
    const loading = comments.preload()
    await tick()
    await sockets[0]!.emit({ type: 'ready' })
    await loading
  }
  return { comments, sockets, calls, ready, setServer: (t: Thread[]) => (server = t) }
}

test('the socket gets the token first; once ready, the threads are read once', async () => {
  const { comments, sockets, calls, ready } = setup()
  await ready()
  expect(sockets[0]!.sent[0]).toBe(JSON.stringify({ type: 'token', token: 'jwt' }))
  expect(calls).toEqual(['open /api/ideas/i1/live', 'list'])
  expect(comments.toArray.map((t) => t.id)).toEqual(['c1'])
})

test('comments, replies and resolves arrive on the socket, without reading the list again', async () => {
  const { comments, sockets, calls, ready } = setup()
  await ready()
  const socket = sockets[0]!
  await socket.emit({ type: 'comment', thread: thread('c2'), by: riley })
  await socket.emit({
    type: 'reply',
    parent: 'c1',
    reply: { id: 'c3', author: riley, createdAt: 2, body: 'Friday.', version: 1 },
    by: riley,
  })
  await socket.emit({ type: 'resolved', comment: 'c2', resolved: true, by: riley })
  expect(comments.get('c1')!.replies.map((r) => r.body)).toEqual(['Friday.'])
  expect(comments.get('c2')!.resolved).toBe(true)
  expect(calls.filter((c) => c === 'list')).toHaveLength(1)
})

test('a new version reads the threads again, and tells the page', async () => {
  const versions: number[] = []
  const { comments, sockets, ready, setServer } = setup([thread('c1')], {}, { onVersion: (v) => versions.push(v) })
  await ready()
  setServer([thread('c1', { state: 'moved' })])
  await sockets[0]!.emit({ type: 'version', version: 2, how: 'commands', by: riley })
  expect(comments.get('c1')!.state).toBe('moved')
  expect(versions).toEqual([2])
})

test('a new comment shows at once, and gives way to the saved one when the socket brings it back', async () => {
  const added: unknown[] = []
  const { comments, sockets, ready } = setup([thread('c1')], {
    addComment: async (input) => {
      added.push(input)
      return { comment: 'c9' }
    },
  })
  await ready()
  const id = pendingId()
  const tx = comments.insert(thread(id, { body: 'New', anchor: { kind: 'section', file: 'f1', section: 'u3' } }))
  expect(comments.get(id)!.body).toBe('New')
  await tick()
  expect(added).toEqual([{ idea: 'i1', version: 1, body: 'New', anchor: { kind: 'section', section: 'u3' } }])
  await sockets[0]!.emit({ type: 'comment', thread: thread('c9', { body: 'New' }), by: riley })
  await tx.when('settled')
  expect(comments.toArray.map((t) => t.id).sort()).toEqual(['c1', 'c9'])
})

test('a refused comment goes away, and the page hears why', async () => {
  const { comments, ready } = setup([thread('c1')], {
    addComment: async () => {
      throw new Error('stale version')
    },
  })
  await ready()
  const id = pendingId()
  const tx = comments.insert(thread(id))
  expect(comments.has(id)).toBe(true)
  await expect(tx.when('settled')).rejects.toThrow('stale version')
  expect(comments.has(id)).toBe(false)
})

test('a reply and a resolve show at once and are sent as such', async () => {
  const sent: string[] = []
  const { comments, sockets, ready } = setup([thread('c1')], {
    reply: async (input) => {
      sent.push(`reply ${input.comment}: ${input.body}`)
      return { comment: 'c10' }
    },
    resolveComment: async (input) => {
      sent.push(`resolve ${input.comment}: ${input.resolved}`)
      return { comment: input.comment, resolved: input.resolved }
    },
  })
  await ready()
  const replied = comments.update('c1', (draft) => {
    draft.replies.push({ id: pendingId(), author: riley, createdAt: 3, body: 'Agreed.', version: 1 })
  })
  expect(comments.get('c1')!.replies.map((r) => r.body)).toEqual(['Agreed.'])
  await tick()
  await sockets[0]!.emit({
    type: 'reply',
    parent: 'c1',
    reply: { id: 'c10', author: riley, createdAt: 3, body: 'Agreed.', version: 1 },
    by: riley,
  })
  await replied.when('settled')
  const resolved = comments.update('c1', (draft) => {
    draft.resolved = true
  })
  await tick()
  await sockets[0]!.emit({ type: 'resolved', comment: 'c1', resolved: true, by: riley })
  await resolved.when('settled')
  expect(sent).toEqual(['reply c1: Agreed.', 'resolve c1: true'])
  expect(comments.get('c1')).toMatchObject({ resolved: true, replies: [{ id: 'c10' }] })
})

test("a write whose echo doesn't come reads the threads again instead", async () => {
  const { comments, calls, ready, setServer } = setup()
  await ready()
  setServer([thread('c1'), thread('c9', { body: 'Saved' })])
  await comments.insert(thread(pendingId(), { body: 'Saved' })).when('settled')
  expect(calls.filter((c) => c === 'list')).toHaveLength(2)
  expect(comments.get('c9')!.body).toBe('Saved')
})

test('a suggestion is sent as one, and a rejection shows at once and resolves it', async () => {
  const sent: unknown[] = []
  const suggestion = { old: 'Ship', new: 'Release', decision: null }
  const { comments, sockets, ready } = setup([thread('c1', { suggestion })], {
    suggestEdit: async (input) => {
      sent.push(input)
      return { comment: 'c9', old: 'Ship' }
    },
    rejectSuggestion: async (input) => {
      sent.push(['reject', input.comment])
      return { comment: input.comment }
    },
  })
  await ready()
  const id = pendingId()
  const tx = comments.insert(thread(id, { body: '', suggestion: { old: 'Ship', new: 'Send', decision: null } }))
  await tick()
  expect(sent).toEqual([
    { idea: 'i1', version: 1, anchor: { kind: 'text', file: 'f1', start: 0, end: 4 }, new: 'Send' },
  ])
  await sockets[0]!.emit({
    type: 'comment',
    thread: thread('c9', { body: '', suggestion: { old: 'Ship', new: 'Send', decision: null } }),
    by: riley,
  })
  await tx.when('settled')

  const rejected = comments.update('c1', (draft) => {
    draft.suggestion!.decision = { kind: 'rejected', by: riley, at: 3, version: null }
    draft.resolved = true
  })
  expect(comments.get('c1')!.resolved).toBe(true)
  await tick()
  expect(sent.at(-1)).toEqual(['reject', 'c1'])
  const decision = { kind: 'rejected' as const, by: riley, at: 3, version: null }
  await sockets[0]!.emit({ type: 'decided', comment: 'c1', decision, by: riley })
  await rejected.when('settled')
  expect(comments.get('c1')!.suggestion!.decision).toEqual(decision)
})

test('a suggestion accepted elsewhere arrives decided, resolving its thread', async () => {
  const { comments, sockets, ready } = setup([
    thread('c1', { suggestion: { old: 'Ship', new: 'Send', decision: null } }),
  ])
  await ready()
  const decision = { kind: 'accepted' as const, by: riley, at: 5, version: 2 }
  await sockets[0]!.emit({ type: 'decided', comment: 'c1', decision, by: riley })
  expect(comments.get('c1')).toMatchObject({ resolved: true, suggestion: { decision } })
})
