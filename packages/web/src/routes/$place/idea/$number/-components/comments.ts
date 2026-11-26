// An idea's comment threads, live, in a TanStack DB collection (the step 8
// spike: docs/implementation-plan.md).
//
// The collection's sync owns the idea's live socket (/api/ideas/{idea}/live).
// Once the server says it's ready, the threads are read in one go, then each
// comment, reply and resolve arrives on the socket and is written in as it
// is: nobody reads the list again. A new version re-reads it, since every
// comment's place in the file has changed. A suggestion accepted or rejected
// arrives as `decided`, resolving its thread.
//
// Writes go through the API like any other client's. Commenting (or
// suggesting) inserts a thread with a temporary ID, and replying, resolving
// or rejecting a suggestion updates one; each
// shows at once. Its handler sends it, then waits for the socket to bring back
// what the server made of it (the server's ID), so the optimistic row gives
// way to the real one without a flicker. If the server refuses it, the
// optimistic change goes away.
import { type ApiClient, LiveEvent } from '@ideaf/api'
import { createCollection } from '@tanstack/react-db'
import type { Thread } from './view.ts'

/** The bits of a WebSocket the sync uses, so tests can stand one in. */
export type SocketLike = Pick<WebSocket, 'send' | 'close' | 'onopen' | 'onmessage' | 'onclose'>

export interface CommentsDeps {
  api: Pick<
    ApiClient,
    | 'listComments'
    | 'addComment'
    | 'suggestEdit'
    | 'reply'
    | 'resolveComment'
    | 'rejectSuggestion'
    | 'deletePendingComment'
  >
  /** Opens a WebSocket to a path on this site. */
  open: (path: string) => SocketLike
  token: () => Promise<string>
  /** The idea has a new version: the page reads the idea again. */
  onVersion?: (version: number) => void
  /** The idea's draft changed, and whether it has uncommitted changes now: the page reads it again. */
  onDraft?: (uncommitted: boolean) => void
  /** Its status changed, or a verdict was given or dismissed: the page reads its reviews again. */
  onReviews?: () => void
  /** A restore point of its draft was taken or deleted: the page reads the list of them again. */
  onRestorePoints?: () => void
  /** How long a write waits for the socket to echo it before reading the threads again instead. */
  echoTimeoutMs?: number
  /** How often the socket gets a fresh token (one counts for 15 minutes at most, and is refreshed in its last minute). */
  tokenEveryMs?: number
}

/** The ID for a comment or reply not yet saved: the server gives it its own. */
export const pendingId = () => `pending-${crypto.randomUUID()}`

// each idea's way to read its threads again, for writes the socket doesn't echo
const rereads = new Map<string, () => Promise<void>>()

/**
 * Reads an idea's threads again: after writing part of a review (which only
 * its author sees, so no event says so), or submitting one.
 */
export const rereadComments = (idea: string) => rereads.get(idea)?.() ?? Promise.resolve()

export function commentsCollection(idea: string, deps: CommentsDeps) {
  const { api } = deps
  // what the server has said, by thread: the collection's synced rows, which
  // the socket's events change one at a time
  const synced = new Map<string, Thread>()
  // the server's IDs (and resolves) the socket has brought back, for writes waiting on them
  const seen = new Set<string>()
  const waiting = new Map<string, () => void>()
  let resync: () => Promise<void> = async () => {}
  rereads.set(idea, () => resync())

  const saw = (key: string) => {
    seen.add(key)
    waiting.get(key)?.()
    waiting.delete(key)
  }
  /** Waits until the socket brings back a write; if it doesn't in time, reads the threads again. */
  const echo = (key: string) =>
    new Promise<void>((resolve) => {
      if (seen.has(key)) {
        return resolve()
      }
      const timer = setTimeout(() => {
        waiting.delete(key)
        void resync().then(resolve, resolve)
      }, deps.echoTimeoutMs ?? 5_000)
      waiting.set(key, () => {
        clearTimeout(timer)
        resolve()
      })
    })

  return createCollection<Thread, string>({
    id: `comments:${idea}`,
    getKey: (thread) => thread.id,
    // a page left and come back to within a minute finds its threads still here, and still live
    gcTime: 60_000,
    sync: {
      sync: ({ begin, write, commit, markReady, reportError, reportHealthy }) => {
        let stopped = false
        let socket: SocketLike | null = null
        let ready = false
        let retry = 0
        let retryTimer: ReturnType<typeof setTimeout> | undefined
        // events that arrive while the threads are being read, applied after
        let reading: LiveEvent[] | null = null

        const put = (thread: Thread) => {
          write({ type: synced.has(thread.id) ? 'update' : 'insert', value: thread })
          synced.set(thread.id, thread)
        }
        const apply = (event: LiveEvent) => {
          if (event.type === 'comment') {
            begin()
            put(event.thread)
            commit()
            saw(event.thread.id)
          } else if (event.type === 'reply') {
            const thread = synced.get(event.parent)
            const known = thread?.replies.find((r) => r.id === event.reply.id)
            // new, or one of the reader's own pending replies, now published
            if (thread && (!known || known.pending !== event.reply.pending)) {
              begin()
              put({
                ...thread,
                replies: known
                  ? thread.replies.map((r) => (r.id === event.reply.id ? event.reply : r))
                  : [...thread.replies, event.reply],
              })
              commit()
            }
            saw(event.reply.id)
          } else if (event.type === 'resolved') {
            const thread = synced.get(event.comment)
            if (thread) {
              begin()
              put({ ...thread, resolved: event.resolved })
              commit()
            }
            saw(`resolved:${event.comment}:${event.resolved}`)
          } else if (event.type === 'decided') {
            const thread = synced.get(event.comment)
            if (thread?.suggestion) {
              begin()
              put({ ...thread, resolved: true, suggestion: { ...thread.suggestion, decision: event.decision } })
              commit()
            }
            saw(`decided:${event.comment}:${event.decision.kind}`)
          }
        }
        // every thread, replacing what's held
        const read = async () => {
          reading = []
          try {
            const threads = await api.listComments({ idea })
            begin({ snapshot: true })
            synced.clear()
            threads.forEach(put)
            commit()
            threads.forEach((t) => [t, ...t.replies].forEach((c) => seen.add(c.id)))
          } finally {
            const queued = reading ?? []
            reading = null
            queued.forEach(apply)
          }
        }
        resync = read

        const connect = () => {
          const ws = deps.open(`/api/ideas/${encodeURIComponent(idea)}/live`)
          socket = ws
          ws.onopen = () => void deps.token().then((token) => ws.send(JSON.stringify({ type: 'token', token })))
          ws.onmessage = async ({ data }) => {
            const event = LiveEvent.parse(JSON.parse(String(data)))
            if (event.type === 'ready') {
              retry = 0
              await read()
              if (!ready) {
                ready = true
                markReady()
              } else {
                reportHealthy()
              }
            } else if (event.type === 'version') {
              deps.onVersion?.(event.version)
              await read()
            } else if (event.type === 'draft') {
              deps.onDraft?.(event.uncommitted)
            } else if (event.type === 'status' || event.type === 'review') {
              deps.onReviews?.()
            } else if (event.type === 'restorePoints') {
              deps.onRestorePoints?.()
            } else if (reading) {
              reading.push(event)
            } else {
              apply(event)
            }
          }
          ws.onclose = ({ code }) => {
            if (stopped) {
              return
            }
            if (ready) {
              reportError(new Error(`the live connection closed (${code}); reconnecting`))
            }
            // try again, waiting longer each time up to half a minute; reconnecting reads the threads again
            retryTimer = setTimeout(connect, Math.min(30_000, 500 * 2 ** retry++))
          }
        }
        connect()
        const refresh = setInterval(
          () => void deps.token().then((token) => socket?.send(JSON.stringify({ type: 'token', token }))),
          deps.tokenEveryMs ?? 30_000,
        )
        return () => {
          stopped = true
          clearInterval(refresh)
          clearTimeout(retryTimer)
          socket?.close()
        }
      },
    },

    onInsert: async ({ transaction }) => {
      for (const { modified: thread } of transaction.mutations) {
        const anchor = thread.anchor
        if (thread.suggestion) {
          if (anchor?.kind !== 'text') {
            throw new Error('a suggestion is on a selection of text')
          }
          const { comment } = await api.suggestEdit({
            idea,
            version: thread.version,
            anchor: { kind: 'text', file: anchor.file, start: anchor.start, end: anchor.end },
            new: thread.suggestion.new,
            ...(thread.body ? { body: thread.body } : {}),
            ...(thread.pending ? { pending: true } : {}),
          })
          await (thread.pending ? resync() : echo(comment))
          continue
        }
        const { comment } = await api.addComment({
          idea,
          version: thread.version,
          body: thread.body,
          anchor:
            anchor?.kind === 'text'
              ? { kind: 'text', file: anchor.file, start: anchor.start, end: anchor.end }
              : anchor?.kind === 'section'
                ? { kind: 'section', section: anchor.section }
                : anchor?.kind === 'block'
                  ? { kind: 'block', block: anchor.block }
                  : anchor?.kind === 'file'
                    ? { kind: 'file', file: anchor.file }
                    : { kind: 'idea' },
          ...(thread.pending ? { pending: true } : {}),
        })
        // a pending comment isn't echoed: only its author sees it
        await (thread.pending ? resync() : echo(comment))
      }
    },

    onDelete: async ({ transaction }) => {
      for (const { original } of transaction.mutations) {
        await api.deletePendingComment({ idea, comment: original.id })
      }
      await resync()
    },

    onUpdate: async ({ transaction }) => {
      for (const { original, modified } of transaction.mutations) {
        for (const reply of modified.replies.filter((r) => !original.replies.some((o) => o.id === r.id))) {
          const { comment } = await api.reply({
            idea,
            comment: modified.id,
            body: reply.body,
            ...(reply.pending ? { pending: true } : {}),
          })
          await (reply.pending ? resync() : echo(comment))
        }
        if (modified.suggestion?.decision?.kind === 'rejected' && !original.suggestion?.decision) {
          await api.rejectSuggestion({ idea, comment: modified.id })
          await echo(`decided:${modified.id}:rejected`)
          continue
        }
        if (modified.resolved !== original.resolved) {
          await api.resolveComment({ idea, comment: modified.id, resolved: modified.resolved })
          await echo(`resolved:${modified.id}:${modified.resolved}`)
        }
      }
    },
  })
}

export type CommentsCollection = ReturnType<typeof commentsCollection>
