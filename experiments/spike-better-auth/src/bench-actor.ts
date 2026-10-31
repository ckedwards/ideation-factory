// Raw RivetKit action latency against this worktree's local engine, to tell
// Better Auth's cost from the hop's.
//
//   bun scripts/worktree.ts exec -- bun experiments/spike-better-auth/src/bench-actor.ts
import { setup } from 'rivetkit'
import { createClient } from 'rivetkit/client'
import { directoryA, directoryB } from './directory.ts'

const registry = setup({ use: { directoryA, directoryB } })
await registry.startAndWait()
const client = createClient<typeof registry>(registry.parseConfig().endpoint!)
const a = client.directoryA.getOrCreate(['main'])

async function timed(label: string, n: number, fn: () => Promise<unknown>) {
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    await fn()
    ms.push(performance.now() - t)
  }
  ms.sort((x, y) => x - y)
  console.log(`${label.padEnd(40)} median ${ms[n >> 1]!.toFixed(2)} ms  p95 ${ms[Math.floor(n * 0.95)]!.toFixed(2)} ms`)
}
await a.stats()
await timed('action, no SQL (stats)', 100, () => a.stats())
await timed('action, SELECT 1', 100, () => a.sql('SELECT 1'))
await timed('action, SELECT a session row', 100, () => a.sql('SELECT * FROM session LIMIT 1'))
await timed('action, UPDATE (write)', 100, () => a.sql(`UPDATE "user" SET "updatedAt" = "updatedAt" WHERE id = 'none'`))
const conn = a.connect()
await conn.stats()
await timed('action over a connection (websocket)', 100, () => conn.stats())
await timed('10 actions in parallel (each)', 20, () => Promise.all(Array.from({ length: 10 }, () => a.stats())))
process.exit(0)
