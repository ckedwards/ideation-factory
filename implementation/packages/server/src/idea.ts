// One Durable Object per idea: its versions (manifests), comments and anchors,
// suggestions, reviews, the edit-command engine and live updates. All writes to
// an idea go through here, in order. Step 2 of the build plan fills it in.
import { DurableObject } from 'cloudflare:workers'

export class Idea extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    return Response.json({ idea: new URL(request.url).pathname.split('/')[2] ?? null, versions: [] })
  }
}
