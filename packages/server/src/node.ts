// One app node, from its settings (main.ts loads them first): hosts the actors (RivetKit) and
// serves the HTTP API in front of them. In development RivetKit starts a local Rivet Engine
// itself, storing data under RIVETKIT_STORAGE_PATH, and file contents go under data/files (the dev
// script sets both to .data/ at the repo root). A deployment runs the engine on its own and names
// it in engine.endpoint and engine.token, with files in a bucket (files/settings.ts).
import { join } from 'node:path'
import { createClient } from 'rivetkit/client'
import { limitDirectoryCalls } from './actors/limit.ts'
import { ensurePools } from './actors/engine-pools.ts'
import { APP_POOL, directoryOf, directoryPool } from './actors/pools.ts'
import { createApp } from './app.ts'
import { authGateway } from './auth/gateway.ts'
import { authSettingsFrom, mailerFrom } from './auth/settings.ts'
import { WorkerPool } from './core-pool/pool.ts'
import { configureNode } from './deps.ts'
import { fileStoreFrom } from './files/settings.ts'
import { timedFileStore } from './files/timed.ts'
import { limitsFrom, MAX_MESSAGE_BYTES } from './limits.ts'
import { notificationEmailFrom } from './mail/sender.ts'
import { createLive, type LiveData } from './live.ts'
import { registry, type Registry } from './registry.ts'
import type { Settings } from './settings/schema.ts'
import { devWebApp, staticWebApp } from './web.ts'

export async function startNode(settings: Settings): Promise<void> {
  const production = process.env.NODE_ENV === 'production'
  const core = new WorkerPool()
  const auth = authSettingsFrom(settings, mailerFrom(settings, production), production)
  configureNode({
    // timed: a summary of its reads and writes in the log once a minute (files/timed.ts)
    files: timedFileStore(fileStoreFrom(settings)),
    core,
    limits: limitsFrom(settings.limits),
    auth,
    email: notificationEmailFrom(settings.email, production),
  })

  // A new engine admits its storage only after about a minute (it must outlast
  // its topology lease), and RivetKit stops waiting before then and exits the
  // process (status 1). Run the app under a supervisor that starts it again
  // (Compose's restart policy, systemd's Restart=); the next start finds it ready.
  // a deployment's engine needs the node pools first (actors/engine-pools.ts); in development
  // RivetKit's own engine has them
  if (process.env.RIVET_ENDPOINT) {
    await ensurePools(process.env.RIVET_ENDPOINT, [APP_POOL, directoryPool()])
  }
  await registry.startAndWait()
  // the engine's address, and its namespace and token (taken out of RIVET_ENDPOINT's URL, when it has them)
  const { endpoint, namespace, token } = registry.parseConfig()
  if (!endpoint) {
    throw new Error('RivetKit has no engine endpoint; set engine.endpoint or run in development')
  }
  // the directory gets at most directory.calls of this node's calls at once (actors/limit.ts)
  const actors = limitDirectoryCalls(
    createClient<Registry>({ endpoint, namespace, ...(token ? { token } : {}) }),
    settings.directory.calls,
  )

  // the web app: Vite's dev server while working on it (bun run dev sets web.dev_url), or the
  // built app, from web.dir or the web package
  const web = settings.web.dev_url
    ? devWebApp(settings.web.dev_url)
    : staticWebApp(settings.web.dir ?? join(import.meta.dir, '../../web/dist'))
  const app = createApp({ actors, auth, web, health: () => registry.routes.health() })
  // each idea's live updates, over a WebSocket beside the API
  const live = createLive({
    actors,
    gateway: authGateway(directoryOf(actors), auth.baseURL, auth.trustedProxies),
  })
  const server = Bun.serve<LiveData>({
    port: settings.port,
    // the largest upload a site may allow, with room for its encoding (limits.ts); Bun answers 413 past it
    maxRequestBodySize: MAX_MESSAGE_BYTES,
    fetch: (request, server) => {
      const upgraded = live.upgrade(request, server)
      return upgraded === null ? app(request, server.requestIP(request)?.address) : upgraded
    },
    websocket: live.websocket,
  })
  console.log(`ideaf server on http://localhost:${server.port} (${core.size} core workers)`)
}
