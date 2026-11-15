// The Markdown size limits: site admins set them per deployment (see
// Deployment settings in docs/architecture.md). Until the admin page exists
// they come from the settings (limits in ideaf.yaml), with these defaults.
export interface Limits {
  /** Largest Markdown file, in bytes. */
  maxFileBytes: number
  /** Largest idea (all its Markdown together), in bytes. */
  maxIdeaBytes: number
}

export const DEFAULT_LIMITS: Limits = { maxFileBytes: 256 * 1024, maxIdeaBytes: 2 * 1024 * 1024 }
export const LIMIT_RANGES = {
  maxFileBytes: { min: 16 * 1024, max: 1024 * 1024 },
  maxIdeaBytes: { min: 256 * 1024, max: 4 * 1024 * 1024 },
} as const

/**
 * The most a request, or a call to an actor and its answer, may carry: four
 * times the largest idea a site may allow, room for its encoding (JSON, CBOR)
 * and what comes with the files. An upload carries its files to the idea's
 * actor and a pull carries them back, so RivetKit's message limits (64 KB in
 * and 1 MB out by default) must allow it too, or bigger ideas fail.
 */
export const MAX_MESSAGE_BYTES = 4 * LIMIT_RANGES.maxIdeaBytes.max

/** The limits in the settings (limits.max_file_bytes and max_idea_bytes, checked against LIMIT_RANGES there). */
export const limitsFrom = (limits: { max_file_bytes: number; max_idea_bytes: number }): Limits => ({
  maxFileBytes: limits.max_file_bytes,
  maxIdeaBytes: limits.max_idea_bytes,
})

export const byteLength = (text: string) => new TextEncoder().encode(text).length

export type SizeProblem = { path: string | null; bytes: number; limit: number }

/**
 * Checks a new version's sizes against the limits. A file or idea already over
 * a limit (because the limit was lowered) may change as long as it doesn't grow.
 */
export function checkSizes(
  limits: Limits,
  before: Map<string, number>,
  after: Array<{ file: string; path: string; bytes: number }>,
): SizeProblem[] {
  const problems: SizeProblem[] = []
  for (const f of after) {
    const old = before.get(f.file) ?? 0
    if (f.bytes > limits.maxFileBytes && f.bytes > old) {
      problems.push({ path: f.path, bytes: f.bytes, limit: limits.maxFileBytes })
    }
  }
  const total = after.reduce((n, f) => n + f.bytes, 0)
  const oldTotal = [...before.values()].reduce((n, b) => n + b, 0)
  if (total > limits.maxIdeaBytes && total > oldTotal) {
    problems.push({ path: null, bytes: total, limit: limits.maxIdeaBytes })
  }
  return problems
}
