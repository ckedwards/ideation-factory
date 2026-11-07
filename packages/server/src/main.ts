// @ideaf/server: one app node. Hosts the actors (RivetKit) and serves the HTTP
// API in front of them. In development RivetKit starts a local Rivet Engine
// itself, storing data under RIVETKIT_STORAGE_PATH; file contents go under
// IDEAF_DATA/files (the dev script sets both to .data/ at the repo root).
import { join } from 'node:path'
import { createClient } from 'rivetkit/client'
import { createApp } from './app.ts'
import { authSettingsFromEnv, mailerFromEnv } from './auth/settings.ts'
import { WorkerPool } from './core-pool/pool.ts'
import { configureNode } from './deps.ts'
import { LocalFolderFileStore } from './files/local-folder.ts'
import { limitsFromEnv } from './limits.ts'
import { registry, type Registry } from './registry.ts'
import { devWebApp, staticWebApp } from './web.ts'

const port = Number(process.env.PORT ?? 8080)
const data = process.env.IDEAF_DATA ?? '.data'

const core = new WorkerPool()
const auth = authSettingsFromEnv(process.env, mailerFromEnv(process.env))
configureNode({
  files: new LocalFolderFileStore(join(data, 'files')),
  core,
  limits: limitsFromEnv(process.env),
  auth,
})

await registry.startAndWait()
const { endpoint } = registry.parseConfig()
if (!endpoint) {
  throw new Error('RivetKit has no engine endpoint; set RIVET_ENDPOINT or run in development')
}
const actors = createClient<Registry>(endpoint)

// the web app: Vite's dev server while working on it (bun run dev sets
// IDEAF_WEB_DEV_URL), or the built app, from IDEAF_WEB_DIR or the web package
const web = process.env.IDEAF_WEB_DEV_URL
  ? devWebApp(process.env.IDEAF_WEB_DEV_URL)
  : staticWebApp(process.env.IDEAF_WEB_DIR ?? join(import.meta.dir, '../../web/dist'))
const app = createApp({ actors, auth, web })
const server = Bun.serve({ port, fetch: (request, server) => app(request, server.requestIP(request)?.address) })
console.log(`ideaf server on http://localhost:${server.port} (${core.size} core workers)`)
