/** Stable exit codes, so scripts and agents can tell outcomes apart. */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  pullFirst: 3,
  conflict: 4,
  notFound: 5,
  unauthorized: 6,
  mergeConflicts: 7,
  localChanges: 8,
  unreachable: 9,
  busy: 10,
  /** A version would make changes in the idea's draft outdated, and wasn't confirmed. */
  draftOutdated: 11,
  /** Something stands in the way, like a reviewer's objection to closing an idea as accepted. */
  blocked: 12,
} as const

export class CliError extends Error {
  constructor(
    message: string,
    readonly exit: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}
