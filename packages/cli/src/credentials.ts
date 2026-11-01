// Where `ideaf auth login` keeps its tokens, one sign-in per server: the OS
// keychain (macOS Keychain, libsecret on Linux, Windows Credential Manager)
// through Bun.secrets, or, where there's no keychain (a headless Linux box
// without a secret service), a file only its owner can read.
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** A sign-in: the refresh token, and the latest access token while it lasts. */
export interface Credentials {
  refreshToken: string
  accessToken: string
  /** When the access token expires, in ms since the epoch. */
  expiresAt: number
}

export interface CredentialStore {
  /** Where it keeps them, for `ideaf auth status`. */
  readonly where: string
  get(server: string): Promise<Credentials | null>
  set(server: string, credentials: Credentials): Promise<void>
  delete(server: string): Promise<void>
}

const SERVICE = 'ideaf'

/** The keychain, or the file if there's no keychain to use. */
export async function systemStore(env: Record<string, string | undefined>): Promise<CredentialStore> {
  const file = fileStore(join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ideaf', 'credentials.json'))
  if (env.IDEAF_CREDENTIALS === 'file') {
    return file
  }
  try {
    // a probe: Bun.secrets throws where there's no secret service
    await Bun.secrets.get({ service: SERVICE, name: '__probe__' })
    return keychainStore()
  } catch {
    return file
  }
}

function keychainStore(): CredentialStore {
  return {
    where: 'the OS keychain',
    async get(server) {
      const value = await Bun.secrets.get({ service: SERVICE, name: server })
      return value ? (JSON.parse(value) as Credentials) : null
    },
    async set(server, credentials) {
      await Bun.secrets.set({ service: SERVICE, name: server, value: JSON.stringify(credentials) })
    },
    async delete(server) {
      await Bun.secrets.delete({ service: SERVICE, name: server })
    },
  }
}

/** A JSON file of sign-ins by server, readable only by its owner (0600). */
export function fileStore(path: string): CredentialStore {
  const readAll = async (): Promise<Record<string, Credentials>> => {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Record<string, Credentials>
    } catch {
      return {}
    }
  }
  const writeAll = async (all: Record<string, Credentials>) => {
    if (Object.keys(all).length === 0) {
      await rm(path, { force: true })
      return
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
    await chmod(path, 0o600)
  }
  return {
    where: path,
    async get(server) {
      return (await readAll())[server] ?? null
    },
    async set(server, credentials) {
      await writeAll({ ...(await readAll()), [server]: credentials })
    },
    async delete(server) {
      const all = await readAll()
      delete all[server]
      await writeAll(all)
    },
  }
}

/** For tests: sign-ins kept in memory. */
export function memoryStore(): CredentialStore {
  const all = new Map<string, Credentials>()
  return {
    where: 'memory',
    get: async (server) => all.get(server) ?? null,
    set: async (server, credentials) => {
      all.set(server, credentials)
    },
    delete: async (server) => {
      all.delete(server)
    },
  }
}
