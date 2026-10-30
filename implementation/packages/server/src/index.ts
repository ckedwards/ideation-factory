// @ideaf/server: the Worker. Routes requests, and sends anything about one idea
// to that idea's Durable Object. Platform specifics (email, blob storage, the
// database, background work) will sit behind small interfaces, with Cloudflare
// implementations now and celld ones later.
import { Idea } from './idea.ts'

export { Idea }

export interface Env {
  IDEA: DurableObjectNamespace<Idea>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') return Response.json({ ok: true })

    // /ideas/<id>/… goes to that idea's Durable Object
    const match = url.pathname.match(/^\/ideas\/([^/]+)(\/.*)?$/)
    if (match?.[1]) {
      const stub = env.IDEA.get(env.IDEA.idFromName(match[1]))
      return stub.fetch(request)
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
