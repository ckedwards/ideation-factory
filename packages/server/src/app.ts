// The HTTP routes in front of the actors, for development. Step 3 of the build
// plan replaces them with routes generated from the operation registry in
// @ideaf/api, and step 6 replaces the dev token with real sign-in.
import type { Client } from 'rivetkit/client'
import type { Caller, WriteErrorCode, WriteResult } from './idea/service.ts'
import type { Registry } from './registry.ts'

export type AppDeps = { actors: Client<Registry>; devToken: string }

const DEV_CALLER: Caller = { user: 'dev', bot: null, purpose: 'me' }
const WRITE_TIMEOUT_MS = 60_000

const STATUS: Record<WriteErrorCode, number> = {
  not_found: 404,
  exists: 409,
  invalid: 400,
  forbidden: 403,
  stale_version: 409,
  pull_first: 409,
  too_large: 413,
  conflict: 409,
}

export function createApp({ actors, devToken }: AppDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/health') return Response.json({ ok: true })
    if (request.headers.get('authorization') !== `Bearer ${devToken}`) return error(401, 'unauthorized', 'send the dev token as "Authorization: Bearer <token>"')

    const match = url.pathname.match(/^\/ideas\/([A-Za-z0-9_-]{1,64})(?:\/(writes|outline|comments|preview|files\/(f[0-9]+)))?$/)
    if (!match) return error(404, 'not_found', 'no such route')
    const [, id, sub, file] = match as [string, string, string | undefined, string | undefined]
    const idea = actors.idea.getOrCreate([id])
    const version = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : undefined

    try {
      if (sub === 'writes' && request.method === 'POST') {
        const body = (await request.json().catch(() => null)) as { key?: unknown; write?: unknown } | null
        if (typeof body?.key !== 'string') return error(400, 'invalid', 'a write is { "key": "<idempotency key>", "write": { … } }')
        const sent = await idea.send('writes', { key: body.key, caller: DEV_CALLER, write: body.write }, { wait: true, timeout: WRITE_TIMEOUT_MS })
        if (sent.status !== 'completed' || !sent.response) return error(504, 'timed_out', 'the write timed out; retry it with the same key')
        return writeResponse(sent.response)
      }
      if (request.method === 'POST' && sub === 'preview') {
        const result = await idea.preview(await request.json().catch(() => null))
        return Response.json(result, { status: result.ok ? 200 : STATUS[result.error.code] })
      }
      if (request.method !== 'GET') return error(405, 'method_not_allowed', `${request.method} isn't allowed here`)
      if (!sub) {
        const summary = await idea.summary()
        return summary ? Response.json(summary) : error(404, 'not_found', "this idea doesn't exist")
      }
      if (sub === 'outline') return Response.json(await idea.outline(version))
      if (sub === 'comments') return Response.json(await idea.comments(version))
      if (file) {
        const found = await idea.file(version, file)
        return found ? Response.json(found) : error(404, 'not_found', `no file ${file} in this version`)
      }
      return error(404, 'not_found', 'no such route')
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code && code in STATUS) return error(STATUS[code as WriteErrorCode], code, (e as Error).message)
      throw e
    }
  }
}

function writeResponse(result: WriteResult): Response {
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.error.code] })
}

function error(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status })
}
