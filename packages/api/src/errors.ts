// Errors every operation can return, with the HTTP status each maps to. The
// body is always { ok: false, error: { code, message, details? } }.
import { z } from 'zod'

export const ERROR_STATUS = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  exists: 409,
  stale_version: 409,
  pull_first: 409,
  conflict: 409,
  /** A version would make changes in the idea's draft outdated: send it again with `outdateDraft` to confirm. */
  draft_outdated: 409,
  /** Something stands in the way, like a reviewer's objection to closing an idea as accepted. */
  blocked: 409,
  too_large: 413,
  internal: 500,
  timed_out: 504,
} as const

export type ApiErrorCode = keyof typeof ERROR_STATUS

export const ApiErrorBody = z.object({
  code: z.enum(Object.keys(ERROR_STATUS) as [ApiErrorCode, ...ApiErrorCode[]]),
  message: z.string(),
  details: z.unknown().optional(),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBody>

/** What the typed client throws when an operation fails. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const isApiErrorCode = (code: unknown): code is ApiErrorCode => typeof code === 'string' && code in ERROR_STATUS
