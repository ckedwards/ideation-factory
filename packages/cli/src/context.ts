// What every command gets: io, the workspace, the API client, output that
// respects --json, and errors with stable exit codes.
import { type ApiClient, ApiError, createApiClient } from '@ideaf/api'
import type { Io } from './io.ts'
import {
  activeIdea,
  IdeaBusy,
  type IdeaState,
  openWorkspace,
  readState,
  type Workspace,
  withIdeaLock,
} from './workspace.ts'

/** Stable exit codes, so scripts and agents can tell outcomes apart. */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  pullFirst: 3,
  conflict: 4,
  notFound: 5,
  unauthorized: 6,
  mergeConflicts: 7,
  localChanges: 8,
  unreachable: 9,
  busy: 10,
} as const

export class CliError extends Error {
  constructor(
    message: string,
    readonly exit: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export interface Context {
  io: Io
  ws: Workspace
  json: boolean
  server: string
  api: ApiClient
  /** The idea to act on: --idea, or the one this working tree is on. */
  idea(flag: string | undefined): Promise<{ id: string; state: IdeaState }>
  /** Like idea(), but holding the idea's lock for the whole of `fn`, with its state read inside the lock. */
  locked<T>(flag: string | undefined, fn: (idea: { id: string; state: IdeaState }) => Promise<T>): Promise<T>
  /** The idea's ID: --idea, or the one this working tree is on (no state needed). */
  ideaId(flag: string | undefined): Promise<string>
  /** Holds an idea's lock for `fn` (for commands that read the state themselves). */
  lock<T>(id: string, fn: () => Promise<T>): Promise<T>
  /** Prints a human line (skipped with --json). */
  say(text: string): void
  /** The command's result: printed as JSON with --json. */
  result(value: unknown): void
}

export function createContext(io: Io, json: boolean): Context {
  const ws = openWorkspace(io.cwd)
  const server = (io.env.IDEAF_URL ?? 'http://localhost:8080').replace(/\/$/, '')
  const token = io.env.IDEAF_TOKEN
  const send = io.fetch ?? ((request: Request) => fetch(request))
  // a personal token is exchanged once per run for a 15-minute access token,
  // so the server checks it by signature instead of asking the directory
  let access: Promise<string> | null = null
  const exchange = async (personal: string): Promise<string> => {
    let response: Response
    try {
      response = await send(
        new Request(`${server}/ideaf/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: personal }),
        }),
      )
    } catch (error) {
      throw new CliError(`couldn't reach ${server}: ${(error as Error).message}`, EXIT.unreachable, 'timed_out')
    }
    const body = (await response.json().catch(() => null)) as { access_token?: string; message?: string } | null
    if (!response.ok || !body?.access_token) {
      throw new CliError(
        `IDEAF_TOKEN was refused: ${body?.message ?? `HTTP ${response.status}`}. Make a new one at ${server}/login`,
        EXIT.unauthorized,
        'unauthorized',
      )
    }
    return body.access_token
  }
  const api = createApiClient({
    baseUrl: server,
    token: () => {
      if (!token) {
        throw new CliError(
          `no token: sign in at ${server}/login, make a personal token, and set IDEAF_TOKEN to it`,
          EXIT.unauthorized,
          'unauthorized',
        )
      }
      if (!token.startsWith('ideaf_')) {
        return token
      }
      access ??= exchange(token)
      return access
    },
    fetch: send,
  })
  const ideaId = async (flag: string | undefined) => {
    const id = flag ?? (await activeIdea(ws))
    if (!id) {
      throw new CliError('no idea here yet: run `ideaf start`, or pass --idea <id>', EXIT.usage, 'no_idea')
    }
    return id
  }
  const stateOf = async (id: string) => {
    const state = await readState(ws, id)
    if (!state) {
      throw new CliError(`no local state for ${id}: run \`ideaf pull --idea ${id}\` first`, EXIT.usage, 'no_state')
    }
    return state
  }
  const waitMs = Number(io.env.IDEAF_LOCK_WAIT_MS ?? 5000)
  const lock = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await withIdeaLock(ws, id, fn, waitMs)
    } catch (error) {
      if (error instanceof IdeaBusy) {
        throw new CliError(
          `${error.message}; try again when it's done, or run \`ideaf unlock\` if it crashed or was interrupted`,
          EXIT.busy,
          'busy',
          error.holder ?? undefined,
        )
      }
      throw error
    }
  }
  return {
    io,
    ws,
    json,
    server,
    api,
    async idea(flag) {
      const id = await ideaId(flag)
      return { id, state: await stateOf(id) }
    },
    async locked(flag, fn) {
      const id = await ideaId(flag)
      return lock(id, async () => fn({ id, state: await stateOf(id) }))
    },
    lock,
    ideaId,
    say: (text) => {
      if (!json) {
        io.out(text)
      }
    },
    result: (value) => {
      if (json) {
        io.out(JSON.stringify(value, null, 2))
      }
    },
  }
}

/** Turns an API error into the cli's error and exit code. */
export function fromApiError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error
  }
  if (error instanceof ApiError) {
    const exit =
      error.code === 'pull_first'
        ? EXIT.pullFirst
        : error.code === 'conflict' || error.code === 'stale_version'
          ? EXIT.conflict
          : error.code === 'not_found'
            ? EXIT.notFound
            : error.code === 'unauthorized' || error.code === 'forbidden'
              ? EXIT.unauthorized
              : error.code === 'invalid' || error.code === 'too_large'
                ? EXIT.usage
                : error.code === 'timed_out'
                  ? EXIT.unreachable
                  : EXIT.error
    return new CliError(error.message, exit, error.code, error.details)
  }
  return new CliError(error instanceof Error ? error.message : String(error), EXIT.error, 'error')
}
