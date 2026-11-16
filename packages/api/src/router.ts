// Serving operations over HTTP: matching the route, building the input from
// path, query and body, checking who's calling, validating, calling the
// handler, and turning errors into status codes. Web-standard Request and
// Response only, so it runs in Bun and in tests without a server.
import { z } from 'zod'
import { type ApiErrorBody, ERROR_STATUS } from './errors.ts'
import { API_PATH, type Operation, type Output, type ParsedInput, pathParams } from './operation.ts'
import type { Caller } from './schemas.ts'

/**
 * What the caller's token was made to do, when it has a token grant: the grant,
 * and the two things checked on every request without asking anyone. The
 * handlers pass `id` on, so the directory narrows access to the grant's reach.
 */
export type TokenScope = { id: string; readOnly: boolean; limited: boolean }

export type Context = {
  caller: Caller
  /** The token's grant, or null for a token without one (a session's, say). */
  token: TokenScope | null
  /** The write's idempotency key (the Idempotency-Key header), or null for reads. */
  key: string | null
  request: Request
}

export type HandlerResult<T> = { ok: true; value: T } | { ok: false; error: ApiErrorBody }

export type Handlers<Ops extends Record<string, Operation>> = {
  [K in keyof Ops]: (input: ParsedInput<Ops[K]>, context: Context) => Promise<HandlerResult<Output<Ops[K]>>>
}

export interface RouterOptions {
  /**
   * Who's calling: null if the request isn't signed in, or an error to refuse
   * it with (an inactive account's write, say). Gets the operation, so it can
   * check more for writes than for reads.
   */
  authenticate(
    request: Request,
    operation: Operation,
  ): Promise<{ caller: Caller; token?: TokenScope | null } | ApiErrorBody | null>
  /** Check every response against its schema (on in tests, to catch drift). */
  validateOutput?: boolean
  onError?(error: unknown, operation: string): void
}

type Route = { key: string; operation: Operation; pattern: RegExp; params: string[] }

/** Returns a fetch handler, which gives null for a request no operation matches. */
export function createRouter<Ops extends Record<string, Operation>>(
  operations: Ops,
  handlers: Handlers<Ops>,
  options: RouterOptions,
): (request: Request) => Promise<Response | null> {
  const routes: Route[] = Object.entries(operations).map(([key, operation]) => ({
    key,
    operation,
    pattern: new RegExp(`^${API_PATH}${operation.path.replace(/\{[a-zA-Z]+\}/g, '([^/]+)')}$`),
    params: pathParams(operation.path),
  }))

  return async (request) => {
    const url = new URL(request.url)
    const matching = routes.filter((r) => r.pattern.test(url.pathname))
    if (matching.length === 0) {
      return null
    }
    // a fixed segment wins over a parameter: /ideas/count is counting, not the idea "count"
    const route = matching
      .filter((r) => r.operation.method === request.method)
      .toSorted((a, b) => a.params.length - b.params.length)[0]
    if (!route) {
      return error(
        'invalid',
        `${request.method} isn't allowed here; use ${matching.map((r) => r.operation.method).join(' or ')}`,
        405,
      )
    }
    const { operation, key } = route

    const who = await options.authenticate(request, operation)
    if (!who) {
      return error('unauthorized', 'sign in, or send a token as "Authorization: Bearer <token>"')
    }
    if ('code' in who) {
      return error(who.code, who.message)
    }
    const { caller, token = null } = who

    const idempotencyKey = request.headers.get('idempotency-key')
    if (idempotencyKey !== null && (idempotencyKey.length === 0 || idempotencyKey.length > 128)) {
      return error('invalid', 'the Idempotency-Key header must be 1 to 128 characters')
    }

    let raw: Record<string, unknown> = {}
    if (operation.method === 'GET') {
      for (const [name, value] of url.searchParams) {
        raw[name] = value
      }
    } else {
      const text = await request.text()
      if (text) {
        try {
          const body: unknown = JSON.parse(text)
          if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return error('invalid', 'the request body must be a JSON object')
          }
          raw = body as Record<string, unknown>
        } catch {
          return error('invalid', "the request body isn't valid JSON")
        }
      }
    }
    const values = route.pattern.exec(url.pathname)!.slice(1)
    route.params.forEach((name, i) => {
      raw[name] = decodeURIComponent(values[i]!)
    })

    const ran = await runOperation(
      operation,
      handlers[key as keyof Ops] as never,
      raw,
      {
        caller,
        token,
        key: operation.kind === 'write' ? idempotencyKey : null,
        request,
      },
      options,
    )
    return ran.ok ? Response.json(ran.value) : error(ran.error.code, ran.error.message, undefined, ran.error.details)
  }
}

/**
 * An operation's input checked against its schema, its handler called, and
 * its output checked (with `validateOutput`): what the HTTP routes and the
 * hosted MCP server both do with a call. A handler that throws is an
 * `internal` error, reported to `onError`.
 */
export async function runOperation(
  operation: Operation,
  handler: (input: never, context: Context) => Promise<HandlerResult<unknown>>,
  raw: Record<string, unknown>,
  context: Context,
  options: Pick<RouterOptions, 'validateOutput' | 'onError'> = {},
): Promise<{ ok: true; value: unknown } | { ok: false; error: ApiErrorBody }> {
  const parsed = operation.input.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'invalid', message: describeIssues(parsed.error), details: z.treeifyError(parsed.error) },
    }
  }
  try {
    const result = await handler(parsed.data as never, context)
    if (!result.ok) {
      return result
    }
    if (options.validateOutput) {
      const checked = operation.output.safeParse(result.value)
      if (!checked.success) {
        throw new Error(
          `${operation.name} returned output that doesn't match its schema: ${describeIssues(checked.error)}`,
        )
      }
    }
    return result
  } catch (e) {
    options.onError?.(e, operation.name)
    return { ok: false, error: { code: 'internal', message: 'something went wrong on the server' } }
  }
}

function error(code: ApiErrorBody['code'], message: string, status?: number, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: status ?? ERROR_STATUS[code] },
  )
}

/** One line per problem, like `batch.steps.0.old: Too small`. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ')
}
