// The hosted MCP server, at /mcp: the operations marked for agents (`mcp` in
// their definitions) as tools, over MCP's streamable HTTP transport. A tool
// call runs the same handler as the HTTP route, through the same checks
// (runOperation), so the two can't drift apart. Stateless: every request
// carries its token, and nothing is kept between them.
//
// Sign-in is OAuth (auth/config.ts): an MCP client finds the server's
// protected-resource document from the 401 below, signs in, and gets a
// 15-minute JWT whose audience is this server, checked here by signature
// alone. A personal token works too, for clients set up with a fixed header.
import {
  type ApiErrorBody,
  type Caller,
  type Handlers,
  mcpTools,
  type Operation,
  type Operations,
  type TokenScope,
  runOperation,
} from '@ideaf/api'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { MCP_PATH } from './auth/config.ts'

/** What the MCP server needs of the gateway: who's calling, for an operation, with a token for this server. */
export interface McpGateway {
  authenticate(
    request: Request,
    operation: Operation,
    audience: string,
  ): Promise<{ caller: Caller; token: TokenScope | null } | ApiErrorBody | null>
}

/** What agents are told when they connect. */
const INSTRUCTIONS = `Ideation Factory is where people and agents write, review and revise ideas: plans and designs as Markdown files, with versions, comments, suggested edits and reviews.

- Find ideas with list_ideas or search_ideas; an idea's ID, or its address (like mobile/idea/9), names it.
- Read one with show_blocks: each file's sections and blocks, with stable IDs and their text, and the open comments. pull gives the files whole.
- Change an idea with editing commands: build a batch against the blocks you read, check it with preview_edit, then apply it with edit. A batch makes one new version; if the idea moved on, it's replayed onto the latest or refused with what conflicts.
- Comment with add_comment, reply, and suggest_edit (a change others accept or reject). Review with review_idea.
- Your work is labeled with who you are acting as (whoami), so people can tell what an agent did.`

export function createMcp(options: {
  operations: Operations
  handlers: Handlers<Operations>
  gateway: McpGateway
  /** The deployment's URL, without a trailing slash. */
  baseURL: string
  validateOutput?: boolean
  onError?: (error: unknown, operation: string) => void
}): (request: Request) => Promise<Response> {
  const { operations, handlers, gateway, baseURL } = options
  const resource = `${baseURL}${MCP_PATH}`
  const tools = mcpTools(operations)
  const byName = new Map(
    Object.entries(operations)
      .filter(([, operation]) => operation.mcp)
      .map(([key, operation]) => [operation.name, { key, operation }]),
  )

  /** No token, or one that isn't ours: where to sign in (RFC 9728), as MCP clients expect. */
  const unauthorized = (description: string) =>
    Response.json(
      { error: 'invalid_token', error_description: description },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${baseURL}/.well-known/oauth-protected-resource${MCP_PATH}"`,
        },
      },
    )

  return async (request) => {
    // signed in at all? (a read checks the token alone; each tool call checks again for what it does)
    const who = await gateway.authenticate(request, operations.me, resource)
    if (!who) {
      return unauthorized('sign in to use Ideation Factory')
    }
    if ('code' in who) {
      const status = who.code === 'unavailable' ? 503 : 403
      return Response.json(
        { error: status === 503 ? 'temporarily_unavailable' : 'forbidden', error_description: who.message },
        { status },
      )
    }

    const server = new Server(
      { name: 'ideation-factory', version: '1.0.0' },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
    )
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: tools as never }))
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const tool = byName.get(call.params.name)
      if (!tool) {
        return failed(`there's no tool ${call.params.name}`)
      }
      // a write checks more than a read: the token may write it, and the account is active
      const auth = await gateway.authenticate(request, tool.operation, resource)
      if (!auth) {
        return failed('unauthorized: sign in again')
      }
      if ('code' in auth) {
        return failed(`${auth.code}: ${auth.message}`)
      }
      const ran = await runOperation(
        tool.operation,
        handlers[tool.key as keyof Operations] as never,
        (call.params.arguments ?? {}) as Record<string, unknown>,
        {
          caller: auth.caller,
          token: auth.token,
          // MCP has no idempotency key: a write is applied each time it's called
          key: tool.operation.kind === 'write' ? crypto.randomUUID() : null,
          request,
        },
        {
          ...(options.validateOutput ? { validateOutput: true } : {}),
          ...(options.onError ? { onError: options.onError } : {}),
        },
      )
      if (!ran.ok) {
        return failed(`${ran.error.code}: ${ran.error.message}`, ran.error.details)
      }
      const structured = typeof ran.value === 'object' && ran.value !== null && !Array.isArray(ran.value)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(ran.value) }],
        ...(structured ? { structuredContent: ran.value as Record<string, unknown> } : {}),
      }
    })

    // no session IDs (stateless), and a JSON answer rather than a stream
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(request)
  }
}

/** A tool's failure, as MCP reports one: a result marked as an error, with what went wrong, for the agent to act on. */
function failed(message: string, details?: unknown) {
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: details === undefined ? message : `${message}\n${JSON.stringify(details)}` },
    ],
  }
}
