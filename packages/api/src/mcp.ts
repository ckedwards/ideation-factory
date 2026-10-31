// The MCP tool definitions, from the same operations. The hosted MCP server
// (later in the build) lists these and calls the same handlers as the HTTP
// routes, not the API over the network.
import { z } from 'zod'
import type { Operation } from './operation.ts'

export interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations: { readOnlyHint: boolean; idempotentHint: boolean }
}

export function mcpTools(operations: Record<string, Operation>): McpTool[] {
  return Object.values(operations).map((operation) => {
    const output = z.toJSONSchema(operation.output, { io: 'output' }) as Record<string, unknown>
    return {
      name: operation.name,
      title: operation.summary,
      description: operation.description,
      inputSchema: z.toJSONSchema(operation.input, { io: 'input' }) as Record<string, unknown>,
      // MCP structured output must be an object
      ...(output.type === 'object' ? { outputSchema: output } : {}),
      annotations: { readOnlyHint: operation.kind === 'read', idempotentHint: true },
    }
  })
}
