// What the actors share on this app node: the file store, the core worker
// pool, the size limits, and the auth settings. main.ts (or a test) configures them before
// the registry starts; actors read them when they wake.
import type { AuthSettings } from './auth/config.ts'
import type { CoreRunner } from './core-pool/runner.ts'
import type { FileStore } from './files/store.ts'
import type { Limits } from './limits.ts'

export interface NodeDeps {
  files: FileStore
  core: CoreRunner
  limits: Limits
  auth: AuthSettings
}

let current: NodeDeps | null = null

export function configureNode(deps: NodeDeps): void {
  current = deps
}

export function nodeDeps(): NodeDeps {
  if (!current) {
    throw new Error('the app node is not configured: call configureNode() before starting the registry')
  }
  return current
}
