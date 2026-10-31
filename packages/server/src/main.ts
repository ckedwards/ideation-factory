// @ideaf/server: one app node. Hosts the actors (RivetKit) and serves the HTTP
// API in front of them. In development RivetKit starts a local Rivet Engine
// itself, storing data under RIVETKIT_STORAGE_PATH (the dev script sets
// .data/ at the repo root).
import { createClient } from 'rivetkit/client'
import { createApp } from './app.ts'
import { registry, type Registry } from './registry.ts'

const port = Number(process.env.PORT ?? 8080)

await registry.startAndWait()
const { endpoint } = registry.parseConfig()
if (!endpoint) throw new Error('RivetKit has no engine endpoint; set RIVET_ENDPOINT or run in development')
const actors = createClient<Registry>(endpoint)

const server = Bun.serve({ port, fetch: createApp({ actors }) })
console.log(`ideaf server on http://localhost:${server.port}`)
