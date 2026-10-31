// Serving operations over HTTP: matching the route, building the input from
// path, query and body, checking who's calling, validating, calling the
// handler, and turning errors into status codes. Web-standard Request and
// Response only, so it runs in Bun and in tests without a server.
import { z } from 'zod'
import { type ApiErrorBody, ERROR_STATUS } from './errors.ts'
import { type Operation, type Output, type ParsedInput, pathParams } from './operation.ts'
import type { Caller } from './schemas.ts'

export type Context = {
  caller: Caller
  /** The write's idempotency key (the Idempotency-Key header), or null for reads. */
  key: string | null
  request: Request
}

export type HandlerResult<T> = { ok: true; value: T } | { ok: false; error: ApiErrorBody }

export type Handlers<Ops extends Record<string, Operation>> = {
  [K in keyof Ops]: (input: ParsedInput<Ops[K]>, context: Context) => Promise<HandlerResult<Output<Ops[K]>>>
}

export interface RouterOptions {
  /** Who's calling, or null if the request isn't signed in. */
  authenticate(request: Request): Promise<Caller | null>
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
    pattern: new RegExp(`^${operation.path.replace(/\{[a-zA-Z]+\}/g, '([^/]+)')}$`),
    params: pathParams(operation.path),
  }))

  return async (request) => {
    const url = new URL(request.url)
    const matching = routes.filter((r) => r.pattern.test(url.pathname))
    if (matching.length === 0) {
      return null
    }
    const route = matching.find((r) => r.operation.method === request.method)
    if (!route) {
      return error(
        'invalid',
        `${request.method} isn't allowed here; use ${matching.map((r) => r.operation.method).join(' or ')}`,
        405,
      )
    }
    const { operation, key } = route

    const caller = await options.authenticate(request)
    if (!caller) {
      return error('unauthorized', 'sign in, or send a token as "Authorization: Bearer <token>"')
    }

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

    const parsed = operation.input.safeParse(raw)
    if (!parsed.success) {
      return error('invalid', describeIssues(parsed.error), undefined, z.treeifyError(parsed.error))
    }

    try {
      const handler = handlers[key as keyof Ops]
      const result = await handler(parsed.data as never, {
        caller,
        key: operation.kind === 'write' ? idempotencyKey : null,
        request,
      })
      if (!result.ok) {
        return error(result.error.code, result.error.message, undefined, result.error.details)
      }
      if (options.validateOutput) {
        const checked = operation.output.safeParse(result.value)
        if (!checked.success) {
          throw new Error(
            `${operation.name} returned output that doesn't match its schema: ${describeIssues(checked.error)}`,
          )
        }
      }
      return Response.json(result.value)
    } catch (e) {
      options.onError?.(e, operation.name)
      return error('internal', 'something went wrong on the server')
    }
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
