// Starting the actors for tests: once per test process, on this worktree's own
// Rivet Engine. Refuses to run without the worktree's settings, which only
// `bun run test` provides (RivetKit reads them before any code runs, so they
// can't be set from here); otherwise the engine's data would go to ~/.rivetkit
// and the engine would be shared with other worktrees.
import { createClient, type Client } from 'rivetkit/client'
import { inProcessCore } from './core-pool/runner.ts'
import { configureNode, type NodeDeps } from './deps.ts'
import { MemoryFileStore } from './files/memory.ts'
import { DEFAULT_LIMITS } from './limits.ts'
import { registry, type Registry } from './registry.ts'

let started: Promise<Client<Registry>> | null = null

export function startTestActors(deps: Partial<NodeDeps> = {}): Promise<Client<Registry>> {
  if (!process.env.RIVETKIT_STORAGE_PATH || !process.env.RIVET_RUN_ENGINE_PORT) {
    throw new Error('run the tests with `bun run test`: it gives this worktree its own Rivet Engine and data folder')
  }
  // index rows catch up quickly in tests
  process.env.IDEAF_INDEX_DELAY_MS ??= '100'
  configureNode({ files: new MemoryFileStore(), core: inProcessCore(), limits: DEFAULT_LIMITS, ...deps })
  started ??= (async () => {
    registry.config.noWelcome = true
    await registry.startAndWait()
    return createClient<Registry>(registry.parseConfig().endpoint!)
  })()
  return started
}
