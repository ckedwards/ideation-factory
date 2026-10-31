// The OpenAPI description, from the same definitions, for anyone writing
// another client. Served at /openapi.json.
import { z } from 'zod'
import { ApiErrorBody } from './errors.ts'
import { type Operation, pathParams } from './operation.ts'

export function openApiDocument(
  operations: Record<string, Operation>,
  info: { title: string; version: string },
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  const errorSchema = { type: 'object', properties: { error: z.toJSONSchema(ApiErrorBody) }, required: ['error'] }
  for (const operation of Object.values(operations)) {
    const params = pathParams(operation.path)
    const shape = operation.input.shape as Record<string, z.ZodType>
    const parameters: unknown[] = params.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: z.toJSONSchema(shape[name]!, { io: 'input' }),
    }))
    if (operation.kind === 'write') {
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description: 'Reuse it to retry a write safely: the write is applied once.',
        schema: { type: 'string', maxLength: 128 },
      })
    }
    const rest = Object.keys(shape).filter((name) => !params.includes(name))
    const entry: Record<string, unknown> = {
      operationId: operation.name,
      summary: operation.summary,
      description: operation.description,
      responses: {
        '200': {
          description: 'OK',
          content: { 'application/json': { schema: z.toJSONSchema(operation.output, { io: 'output' }) } },
        },
        default: { description: 'An error', content: { 'application/json': { schema: errorSchema } } },
      },
    }
    if (operation.method === 'GET') {
      for (const name of rest) {
        const field = shape[name]!
        parameters.push({
          name,
          in: 'query',
          required: !field.safeParse(undefined).success,
          schema: z.toJSONSchema(field, { io: 'input' }),
        })
      }
    } else {
      const body = operation.input.omit(Object.fromEntries(params.map((p) => [p, true])) as never)
      entry.requestBody = {
        required: true,
        content: { 'application/json': { schema: z.toJSONSchema(body, { io: 'input' }) } },
      }
    }
    entry.parameters = parameters
    paths[operation.path] = { ...paths[operation.path], [operation.method.toLowerCase()]: entry }
  }
  return {
    openapi: '3.1.0',
    info,
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
    paths,
  }
}
