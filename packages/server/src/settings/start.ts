// What every entry point does first (the server, admin.ts): loads the settings, says what's wrong
// with them and stops if anything is, and hands RivetKit the engine's settings in its own RIVET_*
// variables, which it reads when the registry is set up. So an entry point imports the registry
// (and everything that imports it) only after this, with a dynamic import.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setDirectoryPool } from '../actors/pools.ts'
import type { Settings } from './schema.ts'
import { loadSettings, SettingsError } from './load.ts'

/**
 * The RIVET_* variables RivetKit takes the engine's settings from, where they aren't set already:
 * RivetKit's own variables win. The node version is the build's own (its build-version file)
 * unless engine.node_version or RIVET_NODE_VERSION says otherwise.
 */
export function engineEnv(
  settings: Settings,
  env: Record<string, string | undefined>,
  buildVersion: string | null = null,
): Record<string, string> {
  const out: Record<string, string> = {}
  const { endpoint, token, namespace, pool, node_version } = settings.engine
  if (!env.RIVET_ENDPOINT && endpoint) {
    const url = new URL(endpoint)
    if (token) {
      url.username = encodeURIComponent(namespace)
      url.password = encodeURIComponent(token)
    }
    out.RIVET_ENDPOINT = url.toString().replace(/\/$/, '')
  }
  if (!env.RIVET_POOL && pool) {
    out.RIVET_POOL = pool
  }
  const version = node_version ?? buildVersion
  if (!env.RIVET_NODE_VERSION && version) {
    out.RIVET_NODE_VERSION = String(version)
  }
  return out
}

/** The build's node version, written into the image or the release when it's built. */
function buildVersion(): string | null {
  const file = join(import.meta.dir, '../../../../build-version')
  return existsSync(file) ? readFileSync(file, 'utf8').trim() || null : null
}

/** Loads the settings for this process, applies them, and returns them; exits on a mistake. */
export function startWithSettings(): Settings {
  let loaded
  try {
    loaded = loadSettings()
  } catch (error) {
    if (error instanceof SettingsError) {
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }
  for (const warning of loaded.warnings) {
    console.warn(`warning: ${warning}`)
  }
  if (loaded.sources.length > 0) {
    console.log(`settings from ${loaded.sources.join(', ')}`)
  }
  Object.assign(process.env, engineEnv(loaded.settings, process.env, buildVersion()))
  setDirectoryPool(loaded.settings.directory.pool)
  return loaded.settings
}
