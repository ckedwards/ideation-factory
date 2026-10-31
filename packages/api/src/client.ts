// The typed client the cli and the web app use: one method per operation,
// with input validated locally (so mistakes show before anything is sent,
// with the server's own messages), an idempotency key on every write, and
// retries that reuse it, so a retried write is applied once.
import { ApiError, ApiErrorBody } from './errors.ts'
import { type Input, type Operation, type Output, pathParams } from './operation.ts'
import { type Operations, operations as allOperations } from './operations.ts'
import { describeIssues } from './router.ts'

export interface ClientOptions {
  /** Where the API is, e.g. https://ideas.example.com */
  baseUrl: string
  /** A token, or a function that returns a current one (refreshing it if needed). */
  token?: string | (() => string | Promise<string>)
  /** Defaults to the global fetch. Tests pass the router directly. */
  fetch?: (request: Request) => Promise<Response>
  /** How many times to retry after a network error or a timeout (default 2). */
  retries?: number
  /** Check responses against their schemas (on in tests). */
  validateOutput?: boolean
}

export interface CallOptions {
  /** For a write: reuse a key to make sure the write is applied once, even across processes. */
  idempotencyKey?: string
  signal?: AbortSignal
}

export type ApiClient<Ops extends Record<string, Operation> = Operations> = {
  [K in keyof Ops]: (input: Input<Ops[K]>, options?: CallOptions) => Promise<Output<Ops[K]>>
}

const RETRYABLE = new Set([502, 503, 504])

export function createApiClient<Ops extends Record<string, Operation> = Operations>(
  options: ClientOptions,
  operations: Ops = allOperations as unknown as Ops,
): ApiClient<Ops> {
  const base = options.baseUrl.replace(/\/$/, '')
  const send = options.fetch ?? ((request: Request) => fetch(request))
  const retries = options.retries ?? 2

  const call = async (operation: Operation, input: unknown, callOptions: CallOptions = {}): Promise<unknown> => {
    const parsed = operation.input.safeParse(input)
    if (!parsed.success) throw new ApiError('invalid', describeIssues(parsed.error), 0, parsed.error.issues)
    const values = { ...(parsed.data as Record<string, unknown>) }
    let path = operation.path
    for (const name of pathParams(operation.path)) {
      path = path.replace(`{${name}}`, encodeURIComponent(String(values[name])))
      delete values[name]
    }
    const url = new URL(base + path)
    let body: string | undefined
    if (operation.method === 'GET') {
      for (const [name, value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(name, String(value))
    } else {
      body = JSON.stringify(values)
    }
    const key = operation.kind === 'write' ? (callOptions.idempotencyKey ?? crypto.randomUUID()) : null

    for (let attempt = 0; ; attempt++) {
      const headers = new Headers({ accept: 'application/json' })
      if (body !== undefined) headers.set('content-type', 'application/json')
      if (key) headers.set('idempotency-key', key)
      const token = typeof options.token === 'function' ? await options.token() : options.token
      if (token) headers.set('authorization', `Bearer ${token}`)
      let response: Response
      try {
        response = await send(new Request(url, { method: operation.method, headers, ...(body !== undefined ? { body } : {}), ...(callOptions.signal ? { signal: callOptions.signal } : {}) }))
      } catch (error) {
        if (callOptions.signal?.aborted || attempt >= retries) throw new ApiError('timed_out', `couldn't reach ${base}: ${error instanceof Error ? error.message : String(error)}`, 0)
        await pause(attempt)
        continue
      }
      if (RETRYABLE.has(response.status) && attempt < retries) {
        await pause(attempt)
        continue
      }
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const parsedError = ApiErrorBody.safeParse((payload as { error?: unknown } | null)?.error)
        if (parsedError.success) throw new ApiError(parsedError.data.code, parsedError.data.message, response.status, parsedError.data.details)
        throw new ApiError('internal', `${operation.name} failed with HTTP ${response.status}`, response.status)
      }
      if (options.validateOutput) {
        const checked = operation.output.safeParse(payload)
        if (!checked.success) throw new ApiError('internal', `${operation.name} returned an unexpected response: ${describeIssues(checked.error)}`, response.status)
      }
      return payload
    }
  }

  const client = {} as Record<string, (input: unknown, o?: CallOptions) => Promise<unknown>>
  for (const [name, operation] of Object.entries(operations)) client[name] = (input, o) => call(operation, input, o)
  return client as ApiClient<Ops>
}

const pause = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
