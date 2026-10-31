// The server's implementation of each operation in @ideaf/api, on top of the
// idea actor. Handlers are typed by the operations' schemas, so a response
// that drifts from what's published doesn't compile.
import { type Caller, type Context, type HandlerResult, type Handlers, isApiErrorCode, type Operations } from '@ideaf/api'
import type { Client } from 'rivetkit/client'
import type { IdeaWrite, WriteResult, WriteValue } from './idea/service.ts'
import type { Registry } from './registry.ts'

const WRITE_TIMEOUT_MS = 60_000

export function createHandlers(actors: Client<Registry>): Handlers<Operations> {
  const ideaOf = (id: string) => actors.idea.getOrCreate([id])

  /** Sends a write through the idea's queue, keyed per caller so two callers' keys can't collide. */
  const write = async <T>(id: string, context: Context, body: IdeaWrite, pick: (value: WriteValue) => T): Promise<HandlerResult<T>> => {
    const key = `${context.caller.user}:${context.key ?? crypto.randomUUID()}`
    const sent = await ideaOf(id).send('writes', { key, caller: context.caller, write: body }, { wait: true, timeout: WRITE_TIMEOUT_MS })
    if (sent.status !== 'completed' || !sent.response) return { ok: false, error: { code: 'timed_out', message: 'the write timed out; retry it with the same idempotency key' } }
    const result: WriteResult = sent.response
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, value: pick(result.value) }
  }

  const version = (value: WriteValue) => {
    if (value.kind !== 'version') throw new Error(`expected a new version, got ${value.kind}`)
    return { version: value.version, comments: value.comments, steps: value.steps }
  }
  const comment = (value: WriteValue) => {
    if (value.kind !== 'comment') throw new Error(`expected a comment, got ${value.kind}`)
    return { comment: value.comment }
  }

  return {
    createIdea: async (input, context) => {
      // the ID comes from the caller and the idempotency key, so a retried create finds the same idea
      const key = context.key ?? crypto.randomUUID()
      const id = await ideaIdFor(context.caller, key)
      return write(id, { ...context, key }, { type: 'create', title: input.title, ...(input.description !== undefined ? { description: input.description } : {}), files: input.files }, (value) => {
        if (value.kind !== 'created') throw new Error(`expected a new idea, got ${value.kind}`)
        return { idea: id, version: value.version }
      })
    },

    getIdea: (input) =>
      read(async () => {
        const summary = await ideaOf(input.idea).summary()
        return summary ?? notFound()
      }),

    showBlocks: (input) =>
      read(async () => {
        const idea = ideaOf(input.idea)
        const v = input.version ?? (await idea.summary())?.latest ?? notFound()
        const [files, comments] = await Promise.all([idea.outline(v), idea.comments(v)])
        return { version: v, files, comments: comments.filter((c) => !c.resolved && c.state !== 'outdated') }
      }),

    pull: (input) => read(() => ideaOf(input.idea).pull(input.version)),

    sync: (input, context) =>
      write(
        input.idea,
        context,
        { type: 'upload', files: input.files, ...(input.deleted ? { deleted: input.deleted } : {}), ...(input.force !== undefined ? { force: input.force } : {}) },
        version,
      ),

    previewEdit: async (input) => {
      const result = await read(() => ideaOf(input.idea).preview(input.batch))
      if (!result.ok) return result
      return result.value.ok ? { ok: true, value: result.value } : { ok: false, error: result.value.error }
    },

    edit: (input, context) => write(input.idea, context, { type: 'edit', batch: input.batch }, version),

    listComments: (input) => read(() => ideaOf(input.idea).comments(input.version)),

    addComment: (input, context) => write(input.idea, context, { type: 'comment', version: input.version, anchor: input.anchor, body: input.body }, comment),

    reply: (input, context) => write(input.idea, context, { type: 'reply', parent: input.comment, body: input.body }, comment),

    resolveComment: (input, context) =>
      write(input.idea, context, { type: 'resolve', comment: input.comment, resolved: input.resolved }, (value) => {
        if (value.kind !== 'resolved') throw new Error(`expected a resolved comment, got ${value.kind}`)
        return { comment: value.comment, resolved: value.resolved }
      }),
  }
}

class NotFound extends Error {}
const notFound = (): never => {
  throw new NotFound()
}

/** Runs an actor read, turning the idea's refusals (UserErrors with our codes) into error results. */
async function read<T>(fn: () => Promise<T>): Promise<HandlerResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    if (error instanceof NotFound) return { ok: false, error: { code: 'not_found', message: "this idea doesn't exist" } }
    const { code, message, metadata } = error as { code?: unknown; message?: string; metadata?: unknown }
    if (isApiErrorCode(code) && code !== 'internal') return { ok: false, error: { code, message: message ?? code, ...(metadata === undefined ? {} : { details: metadata }) } }
    throw error
  }
}

/** A stable idea ID for a create: the same caller and key always give the same ID. */
export async function ideaIdFor(caller: Caller, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${caller.user}\n${key}`))
  return `i${[...new Uint8Array(digest)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
