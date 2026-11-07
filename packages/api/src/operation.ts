// What an operation is: one definition, from which come its HTTP route, its
// OpenAPI description, its MCP tool and its method on the typed client.
import type { z } from 'zod'

export type Method = 'GET' | 'POST'

/**
 * Where the operations are served: under /api, beside sign-in's /api/auth, so
 * the web app's pages can have paths of their own (/teams/mobile is a page,
 * /api/teams/mobile the team). Operations' paths are relative to it.
 */
export const API_PATH = '/api'

export interface Operation<I extends z.ZodObject = z.ZodObject, O extends z.ZodType = z.ZodType> {
  /** snake_case: the MCP tool name and the OpenAPI operationId. */
  name: string
  summary: string
  /** For people and agents: what it does, when to use it, what can go wrong. Shown in MCP tool lists and the API docs. */
  description: string
  method: Method
  /** Under API_PATH. `{field}` segments are taken from the input. Other input goes in the query (GET) or the JSON body (POST). */
  path: string
  /** Writes take an idempotency key, so a retry is applied once. */
  kind: 'read' | 'write'
  input: I
  output: O
}

/**
 * An idea's address on the web, like a pull request's: /mobile/idea/9, or
 * /@riley/idea/3 for someone's own. `place` and `number` are what get_idea and
 * create_idea return.
 */
export function ideaPath(place: string, number: number): string {
  return `/${encodeURIComponent(place).replace(/^%40/, '@')}/idea/${number}`
}

export function defineOperation<I extends z.ZodObject, O extends z.ZodType>(
  operation: Operation<I, O>,
): Operation<I, O> {
  return operation
}

export type Input<Op> = Op extends Operation<infer I, z.ZodType> ? z.input<I> : never
export type ParsedInput<Op> = Op extends Operation<infer I, z.ZodType> ? z.output<I> : never
export type Output<Op> = Op extends Operation<z.ZodObject, infer O> ? z.output<O> : never

/** The `{field}` names in a path, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!)
}
