// The HTTP routes in front of the actors. Step 3 of the build plan replaces
// these hand-written routes with ones generated from the operation registry in
// @ideaf/api; until then they're just enough to drive an idea actor.
import type { Client } from 'rivetkit/client'
import type { Registry } from './registry.ts'

export type AppDeps = { actors: Client<Registry> }

const WRITE_TIMEOUT_MS = 10_000

export function createApp({ actors }: AppDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/health') return Response.json({ ok: true })

    const match = url.pathname.match(/^\/ideas\/([A-Za-z0-9_-]{1,64})(\/title)?$/)
    if (match?.[1]) {
      const idea = actors.idea.getOrCreate([match[1]])
      if (!match[2] && request.method === 'GET') return Response.json(await idea.get())
      if (match[2] && request.method === 'PUT') {
        const body = (await request.json().catch(() => null)) as { title?: unknown } | null
        if (typeof body?.title !== 'string') return Response.json({ error: 'title_required' }, { status: 400 })
        const result = await idea.send('writes', { type: 'set-title', title: body.title }, { wait: true, timeout: WRITE_TIMEOUT_MS })
        if (result.status !== 'completed' || !result.response) {
          return Response.json({ error: 'write_timed_out' }, { status: 504 })
        }
        return Response.json(result.response, { status: result.response.ok ? 200 : 400 })
      }
      return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
