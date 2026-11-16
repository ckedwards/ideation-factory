// The registry machinery with fake handlers: routing, validation, errors,
// idempotency keys and retries, and the OpenAPI and MCP output.
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createApiClient } from './client.ts'
import { ApiError } from './errors.ts'
import { mcpTools } from './mcp.ts'
import { openApiDocument } from './openapi.ts'
import { defineOperation } from './operation.ts'
import { operations } from './operations.ts'
import { type Context, createRouter, type Handlers } from './router.ts'
import { type Caller, GitHint } from './schemas.ts'

const ME: Caller = { user: 'riley', bot: null, purpose: 'me' }

const ops = {
  getThing: defineOperation({
    name: 'get_thing',
    summary: 'Get a thing',
    description: 'Gets one.',
    method: 'GET',
    path: '/things/{thing}',
    kind: 'read',
    input: z.strictObject({
      thing: z.string().regex(/^t[0-9]+$/),
      version: z.coerce.number().int().positive().optional(),
    }),
    output: z.object({ thing: z.string(), version: z.number().nullable() }),
  }),
  countThings: defineOperation({
    name: 'count_things',
    summary: 'Count things',
    description: 'Counts them.',
    method: 'GET',
    path: '/things/count',
    kind: 'read',
    input: z.strictObject({}),
    output: z.object({ count: z.number() }),
  }),
  renameThing: defineOperation({
    name: 'rename_thing',
    summary: 'Rename a thing',
    description: 'Renames one.',
    method: 'POST',
    path: '/things/{thing}/name',
    kind: 'write',
    input: z.strictObject({ thing: z.string(), name: z.string().trim().min(1) }),
    output: z.object({ name: z.string() }),
  }),
} as const

function setup(overrides: Partial<Handlers<typeof ops>> = {}) {
  const seen: Array<{ input: unknown; context: Context }> = []
  const handlers: Handlers<typeof ops> = {
    getThing: async (input, context) => {
      seen.push({ input, context })
      return input.thing === 't404'
        ? { ok: false, error: { code: 'not_found', message: 'no such thing' } }
        : { ok: true, value: { thing: input.thing, version: input.version ?? null } }
    },
    countThings: async () => ({ ok: true, value: { count: 2 } }),
    renameThing: async (input, context) => {
      seen.push({ input, context })
      return { ok: true, value: { name: input.name } }
    },
    ...overrides,
  }
  const router = createRouter(ops, handlers, {
    authenticate: async (request) => (request.headers.get('authorization') === 'Bearer good' ? { caller: ME } : null),
    validateOutput: true,
  })
  const fetch = async (request: Request) => (await router(request)) ?? new Response('no route', { status: 404 })
  const client = createApiClient({ baseUrl: 'http://api.test', token: 'good', fetch, validateOutput: true }, ops)
  return { router, fetch, client, seen }
}

describe('the router', () => {
  test('builds the input from the path and query, and passes the caller', async () => {
    const { router, seen } = setup()
    const response = await router(
      new Request('http://x/api/things/t1?version=3', { headers: { authorization: 'Bearer good' } }),
    )
    expect(response!.status).toBe(200)
    expect(await response!.json()).toEqual({ thing: 't1', version: 3 })
    expect(seen[0]).toMatchObject({ input: { thing: 't1', version: 3 }, context: { caller: ME, key: null } })
  })

  test('a fixed segment wins over a parameter, whichever is defined first', async () => {
    const { router } = setup()
    const response = await router(
      new Request('http://x/api/things/count', { headers: { authorization: 'Bearer good' } }),
    )
    expect(await response!.json()).toEqual({ count: 2 })
  })

  test('takes the body for a write, and its idempotency key', async () => {
    const { router, seen } = setup()
    const response = await router(
      new Request('http://x/api/things/t1/name', {
        method: 'POST',
        headers: { authorization: 'Bearer good', 'idempotency-key': 'k1' },
        body: JSON.stringify({ name: '  New  ' }),
      }),
    )
    expect(await response!.json()).toEqual({ name: 'New' })
    expect(seen[0]!.context.key).toBe('k1')
  })

  test('refuses unknown fields, bad values, bad JSON and missing sign-in, with the right status', async () => {
    const { router } = setup()
    const auth = { authorization: 'Bearer good' }
    const status = async (request: Request) => (await router(request))!.status
    expect(await status(new Request('http://x/api/things/t1?extra=1', { headers: auth }))).toBe(400)
    expect(await status(new Request('http://x/api/things/nope', { headers: auth }))).toBe(400)
    expect(await status(new Request('http://x/api/things/t1/name', { method: 'POST', headers: auth, body: '{' }))).toBe(
      400,
    )
    expect(await status(new Request('http://x/api/things/t1'))).toBe(401)
    expect(await status(new Request('http://x/api/things/t1', { method: 'POST', headers: auth }))).toBe(405)
    expect(await status(new Request('http://x/api/things/t404', { headers: auth }))).toBe(404)
    expect(await router(new Request('http://x/other'))).toBeNull()
    // operations are under /api; the paths beside it are the web app's pages
    expect(await router(new Request('http://x/things/t1', { headers: auth }))).toBeNull()
  })

  test('a validation error says where the problem is', async () => {
    const { router } = setup()
    const response = await router(
      new Request('http://x/api/things/t1/name', {
        method: 'POST',
        headers: { authorization: 'Bearer good' },
        body: JSON.stringify({ name: '' }),
      }),
    )
    expect(await response!.json()).toMatchObject({
      error: { code: 'invalid', message: expect.stringContaining('name:') },
    })
  })

  test("a handler's output that doesn't match its schema is a server error, not a broken response", async () => {
    const { router } = setup({ getThing: async () => ({ ok: true, value: { thing: 1 } as never }) })
    const response = await router(new Request('http://x/api/things/t1', { headers: { authorization: 'Bearer good' } }))
    expect(response!.status).toBe(500)
  })
})

describe('the typed client', () => {
  test('calls operations by name, with typed input and output', async () => {
    const { client } = setup()
    expect(await client.getThing({ thing: 't7', version: 2 })).toEqual({ thing: 't7', version: 2 })
    expect(await client.renameThing({ thing: 't7', name: 'x' })).toEqual({ name: 'x' })
  })

  test('validates input locally, before sending anything', async () => {
    const { client, seen } = setup()
    await expect(client.getThing({ thing: 'bad' })).rejects.toMatchObject({ code: 'invalid', status: 0 })
    expect(seen).toHaveLength(0)
  })

  test('throws ApiError with the code, message and status', async () => {
    const { client } = setup()
    const error = await client.getThing({ thing: 't404' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'not_found', message: 'no such thing', status: 404 })
  })

  test('retries a write after a timeout with the same idempotency key', async () => {
    const keys: Array<string | null> = []
    const { fetch } = setup()
    let failures = 1
    const flaky = async (request: Request) => {
      keys.push(request.headers.get('idempotency-key'))
      if (failures-- > 0) {
        return new Response('', { status: 504 })
      }
      return fetch(request)
    }
    const client = createApiClient({ baseUrl: 'http://api.test', token: 'good', fetch: flaky }, ops)
    expect(await client.renameThing({ thing: 't1', name: 'y' })).toEqual({ name: 'y' })
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1]!)
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('a token can come from a function, for refreshing', async () => {
    const { fetch } = setup()
    const client = createApiClient({ baseUrl: 'http://api.test', token: async () => 'good', fetch }, ops)
    expect(await client.getThing({ thing: 't1' })).toEqual({ thing: 't1', version: null })
  })
})

describe('generated descriptions', () => {
  test('OpenAPI: every operation, with path and query parameters, bodies for writes, and the idempotency header', () => {
    const doc = openApiDocument(operations, { title: 'Ideation Factory', version: '0' }) as {
      paths: Record<
        string,
        Record<string, { operationId: string; parameters: Array<{ name: string; in: string }>; requestBody?: unknown }>
      >
    }
    const all = Object.values(doc.paths).flatMap((p) => Object.values(p))
    expect(all.map((o) => o.operationId).toSorted()).toEqual(
      Object.values(operations)
        .map((o) => o.name)
        .toSorted(),
    )
    const blocks = doc.paths['/ideas/{idea}/blocks']!.get!
    expect(blocks.parameters).toEqual([
      expect.objectContaining({ name: 'idea', in: 'path' }),
      expect.objectContaining({ name: 'version', in: 'query' }),
    ])
    const edit = doc.paths['/ideas/{idea}/edits']!.post!
    expect(edit.parameters).toContainEqual(expect.objectContaining({ name: 'Idempotency-Key', in: 'header' }))
    expect(edit.requestBody).toMatchObject({
      content: { 'application/json': { schema: { properties: { batch: expect.any(Object) } } } },
    })
  })

  test('MCP: a tool for each operation marked for agents, reads marked read-only and only reads idempotent', () => {
    const tools = mcpTools(operations)
    expect(tools.map((t) => t.name)).toEqual(
      Object.values(operations)
        .filter((o) => o.mcp)
        .map((o) => o.name),
    )
    // what agents work with, and not what's for people
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['show_blocks', 'edit', 'add_comment', 'review_idea']),
    )
    expect(tools.map((t) => t.name)).not.toEqual(expect.arrayContaining(['set_access']))
    expect(tools.map((t) => t.name)).not.toContain('update_team_settings')
    expect(tools.find((t) => t.name === 'show_blocks')!.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
    })
    expect(tools.find((t) => t.name === 'edit')!.annotations).toEqual({ readOnlyHint: false, idempotentHint: false })
    expect(tools.find((t) => t.name === 'edit')!.inputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['idea', 'batch']),
    })
    // MCP structured output must be an object, so a list doesn't declare one
    expect(tools.find((t) => t.name === 'list_comments')!.outputSchema).toBeUndefined()
  })
})

test('a git hint names a repository, never a URL that could carry credentials', () => {
  const ok = (uri: string | null) => GitHint.safeParse({ uri, branch: 'main' }).success
  expect(ok('github.com/acme/plans')).toBe(true)
  expect(ok(null)).toBe(true)
  expect(ok('https://github.com/acme/plans.git')).toBe(false)
  expect(ok('ghp_token@github.com/acme/plans')).toBe(false)
  expect(ok('git@github.com:acme/plans.git')).toBe(false)
  expect(ok('/srv/git/plans')).toBe(false) // a path is only meaningful on one machine
  expect(ok('C:\\repos\\plans')).toBe(false)
})
