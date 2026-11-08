// What the actors share on this app node: the file store, the core worker
// pool, the size limits, the auth settings, and how notification emails go. main.ts (or a test) configures them before
// the registry starts; actors read them when they wake.
import type { AuthSettings } from './auth/config.ts'
import type { CoreRunner } from './core-pool/runner.ts'
import type { FileStore } from './files/store.ts'
import type { Limits } from './limits.ts'
import type { NotificationEmail } from './mail/sender.ts'

export interface NodeDeps {
  files: FileStore
  core: CoreRunner
  limits: Limits
  auth: AuthSettings
  /** Null when the deployment sends no notification emails. */
  email: NotificationEmail | null
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
