// The hosted MCP server end to end, with the MCP SDK's own client: an MCP
// client finds where to sign in, identifies itself with its metadata document
// (CIMD), gets a token for this server from the consent page's choice, and
// calls tools that run the API's own handlers, attributed to who it acts as.
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
import { createApiClient } from '@ideaf/api'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createApp } from './app.ts'
import { clientHostAllowed } from './auth/config.ts'
import { signIn, startTestActors, TEST_MCP_CLIENT, TEST_MCP_REDIRECT, TEST_URL, testAuth } from './testing.ts'

let app: (request: Request) => Promise<Response>
beforeAll(async () => {
  app = createApp({ actors: await startTestActors(), auth: testAuth, validateOutput: true })
}, 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`
const MCP = `${TEST_URL}/mcp`
const PLAN = '# Plan\n\nThe quick brown fox.\n'

const get = async (path: string, cookie?: string) => {
  const response = await app(new Request(`${TEST_URL}${path}`, cookie ? { headers: { cookie } } : {}))
  return { status: response.status, headers: response.headers, body: (await response.json().catch(() => null)) as any }
}
const post = async (path: string, body: unknown, cookie: string) => {
  const response = await app(
    new Request(`${TEST_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_URL, cookie },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json().catch(() => null)) as any }
}

/** The signed part of the query Better Auth sends the consent page, as the page hands it back. */
function signedQuery(location: string): string {
  const params = new URL(location, TEST_URL).searchParams
  const names = new Set(params.getAll('ba_param'))
  const out = new URLSearchParams()
  for (const [name, value] of params.entries()) {
    if (name === 'sig' || name === 'ba_param' || names.has(name)) {
      out.append(name, value)
    }
  }
  return out.toString()
}

type Tokens = { access_token: string; refresh_token?: string; scope?: string; id_token?: string }

/** An MCP client's sign-in, as the consent page and the client do it: authorize, choose, consent, exchange. */
async function mcpSignIn(cookie: string, grant: Record<string, unknown>, resource = MCP) {
  return (await mcpTokens(cookie, grant, { resource })).access_token
}

/** The same, for all it gets back; `scope` null asks for none, as some clients do. */
async function mcpTokens(
  cookie: string,
  grant: Record<string, unknown>,
  { resource = MCP, scope = 'offline_access' as string | null } = {},
): Promise<Tokens> {
  const verifier = randomBytes(32).toString('base64url')
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: TEST_MCP_CLIENT,
    redirect_uri: TEST_MCP_REDIRECT,
    ...(scope === null ? {} : { scope }),
    state: 'st4te',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource,
    prompt: 'consent',
  })
  const started = await app(
    new Request(`${TEST_URL}/api/auth/oauth2/authorize?${query}`, { headers: { cookie }, redirect: 'manual' }),
  )
  const location = started.headers.get('location') ?? ''
  expect(location).toContain('/consent')
  expect((await post('/api/auth/ideaf/token-grant', { ...grant, forConsent: true }, cookie)).status).toBe(200)
  const consent = await post('/api/auth/oauth2/consent', { accept: true, oauth_query: signedQuery(location) }, cookie)
  expect(consent.status).toBe(200)
  const back = new URL(consent.body.url ?? consent.body.redirect_uri)
  const tokens = await app(
    new Request(`${TEST_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: back.searchParams.get('code')!,
        redirect_uri: TEST_MCP_REDIRECT,
        client_id: TEST_MCP_CLIENT,
        code_verifier: verifier,
        resource,
      }),
    }),
  )
  expect(tokens.status).toBe(200)
  return (await tokens.json()) as Tokens
}

/** A refresh, as an MCP client makes one when its access token runs out. */
async function refresh(refreshToken: string) {
  const response = await app(
    new Request(`${TEST_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: TEST_MCP_CLIENT,
        resource: MCP,
      }),
    }),
  )
  return { status: response.status, body: (await response.json().catch(() => null)) as Tokens | null }
}

/** The MCP SDK's client, connected to /mcp with this token. */
async function connect(token: string) {
  const client = new Client({ name: 'test-agent', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: (url, init) => app(new Request(url, init)),
    }),
  )
  return client
}

const text = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0]!.text

describe('the hosted MCP server', () => {
  test('without a token, says where to sign in; the documents lead to the OAuth server', async () => {
    const refused = await app(
      new Request(MCP, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )
    expect(refused.status).toBe(401)
    const challenge = refused.headers.get('www-authenticate') ?? ''
    const metadataURL = /resource_metadata="([^"]+)"/.exec(challenge)?.[1]
    expect(metadataURL).toBe(`${TEST_URL}/.well-known/oauth-protected-resource/mcp`)

    const resource = await get(new URL(metadataURL!).pathname)
    expect(resource.status).toBe(200)
    expect(resource.body).toMatchObject({ resource: MCP, authorization_servers: [TEST_URL] })
    const server = await get('/.well-known/oauth-authorization-server')
    expect(server.status).toBe(200)
    expect(server.body).toMatchObject({
      issuer: TEST_URL,
      authorization_endpoint: `${TEST_URL}/api/auth/oauth2/authorize`,
      token_endpoint: `${TEST_URL}/api/auth/oauth2/token`,
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    })
  })

  test('an agent signs in by its metadata document, lists its tools and works as a bot for its person', async () => {
    const riley = await signIn(app, h('riley'))
    // the consent page shows the app's name from its document
    expect(
      (await get(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(TEST_MCP_CLIENT)}`, riley.cookie)).body,
    ).toMatchObject({ client_name: 'Test Agent' })
    const token = await mcpSignIn(riley.cookie, { purpose: 'bot-for-me', bot: 'test-agent' })
    const agent = await connect(token)

    const names = (await agent.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['show_blocks', 'edit', 'add_comment', 'review_idea', 'whoami']))
    expect(names).not.toContain('set_access')

    const created = await agent.callTool({
      name: 'create_idea',
      arguments: { title: 'Agent plan', files: [{ path: 'plan.md', content: PLAN }] },
    })
    expect(created.isError).toBeFalsy()
    const idea = (created.structuredContent as { idea: string }).idea
    const blocks = await agent.callTool({ name: 'show_blocks', arguments: { idea } })
    expect(text(blocks)).toContain('The quick brown fox.')
    await agent.callTool({
      name: 'add_comment',
      arguments: { idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'From the agent' },
    })

    // attributed to the bot, acting for riley, as anywhere else
    const comments = await createApiClient({ baseUrl: TEST_URL, token: riley.jwt, fetch: (r) => app(r) }).listComments({
      idea,
    })
    expect(comments[0]).toMatchObject({
      body: 'From the agent',
      author: { user: riley.id, bot: 'test-agent', purpose: 'bot-for-me' },
    })
    expect((await agent.callTool({ name: 'whoami', arguments: {} })).structuredContent).toMatchObject({
      id: riley.id,
    })
    await agent.close()
  })

  test('tools report their problems, and a read-only sign-in can’t write', async () => {
    const maya = await signIn(app, h('maya'))
    const agent = await connect(await mcpSignIn(maya.cookie, { purpose: 'bot-for-me', bot: 'reader', readOnly: true }))
    const listed = await agent.callTool({ name: 'list_ideas', arguments: {} })
    expect(listed.isError).toBeFalsy()
    const refused = await agent.callTool({
      name: 'create_idea',
      arguments: { title: 'Nope', files: [{ path: 'a.md', content: PLAN }] },
    })
    expect(refused).toMatchObject({ isError: true })
    expect(text(refused)).toContain('read only')
    expect(text(await agent.callTool({ name: 'show_blocks', arguments: {} }))).toContain('invalid')
    expect(text(await agent.callTool({ name: 'set_access', arguments: {} }))).toContain('no tool set_access')
    await agent.close()
  })

  test('a token is for one place: the API’s isn’t taken here, nor this one by the API; a personal token is', async () => {
    const sam = await signIn(app, h('sam'))
    const mcpToken = await mcpSignIn(sam.cookie, { purpose: 'me' })
    const api = (token: string) => createApiClient({ baseUrl: TEST_URL, token, fetch: (r) => app(r), retries: 0 })
    await expect(api(mcpToken).me({})).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(connect(sam.jwt)).rejects.toThrow()
    const withPersonal = await connect(sam.token)
    expect((await withPersonal.callTool({ name: 'whoami', arguments: {} })).structuredContent).toMatchObject({
      id: sam.id,
    })
    await withPersonal.close()
  })

  test('it stays signed in: a client that asks for no scope gets a refresh token, and refreshing keeps who it acts as', async () => {
    const devon = await signIn(app, h('devon'))
    const first = await mcpTokens(devon.cookie, { purpose: 'bot-for-me', bot: 'helper' }, { scope: null })
    expect(first.refresh_token).toBeString()
    const refreshed = await refresh(first.refresh_token!)
    expect(refreshed.status).toBe(200)
    // a refresh token works once: the next refresh uses the new one
    expect(refreshed.body!.refresh_token).not.toBe(first.refresh_token)

    const agent = await connect(refreshed.body!.access_token)
    const created = await agent.callTool({
      name: 'create_idea',
      arguments: { title: 'After a refresh', files: [{ path: 'plan.md', content: PLAN }] },
    })
    const idea = (created.structuredContent as { idea: string }).idea
    await agent.callTool({
      name: 'add_comment',
      arguments: { idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Still me' },
    })
    await agent.close()
    const comments = await createApiClient({ baseUrl: TEST_URL, token: devon.jwt, fetch: (r) => app(r) }).listComments({
      idea,
    })
    expect(comments[0]!.author).toMatchObject({ user: devon.id, bot: 'helper', purpose: 'bot-for-me' })

    // removing the app in Settings (its consent) ends it: the next refresh is refused
    const consents = await get('/api/auth/oauth2/get-consents', devon.cookie)
    const consent = (consents.body as Array<{ id: string; clientId: string }>).find(
      (c) => c.clientId === TEST_MCP_CLIENT,
    )!
    expect((await post('/api/auth/oauth2/delete-consent', { id: consent.id }, devon.cookie)).status).toBe(200)
    expect((await refresh(refreshed.body!.refresh_token!)).status).toBeGreaterThanOrEqual(400)
  })

  test('the scopes other clients ask for are accepted; without offline_access there’s nothing to refresh with', async () => {
    const lee = await signIn(app, h('lee'))
    const oidc = await mcpTokens(lee.cookie, { purpose: 'me' }, { scope: 'openid profile email' })
    expect(oidc.refresh_token).toBeUndefined()
    expect(oidc.id_token).toBeString()
    const agent = await connect(oidc.access_token)
    expect((await agent.callTool({ name: 'whoami', arguments: {} })).structuredContent).toMatchObject({ id: lee.id })
    await agent.close()
    const all = await mcpTokens(lee.cookie, { purpose: 'me' }, { scope: 'openid profile email offline_access' })
    expect(all.refresh_token).toBeString()
  })

  test('IDEAF_MCP_CLIENT_HOSTS, when set, lets in only clients whose documents are on those hosts', () => {
    const allowed = clientHostAllowed(['claude.ai', 'vscode.dev'])
    expect(allowed('https://claude.ai/oauth/claude-code-client-metadata')).toBe(true)
    expect(allowed('https://VSCode.dev/oauth/client-metadata.json')).toBe(true)
    expect(allowed('https://evil.example/claude.ai')).toBe(false)
    expect(allowed('not a url')).toBe(false)
  })
})
