// The Markdown size limits: site admins set them per deployment (see
// Deployment settings in docs/architecture.md). Until the admin page exists
// they come from configuration, with these defaults.
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

export function limitsFromEnv(env: Record<string, string | undefined>): Limits {
  const read = (name: string, key: keyof Limits): number => {
    const raw = env[name]
    if (raw === undefined) {
      return DEFAULT_LIMITS[key]
    }
    const value = Number(raw)
    const { min, max } = LIMIT_RANGES[key]
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be a whole number of bytes from ${min} to ${max}`)
    }
    return value
  }
  return {
    maxFileBytes: read('IDEAF_MAX_FILE_BYTES', 'maxFileBytes'),
    maxIdeaBytes: read('IDEAF_MAX_IDEA_BYTES', 'maxIdeaBytes'),
  }
}

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
