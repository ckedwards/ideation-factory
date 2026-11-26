// The Markdown size limits, and how much a live draft takes on: site admins set them per
// deployment (see Deployment settings in docs/architecture.md). Until the admin page exists they
// come from the settings (limits in ideaf.yaml), with these defaults.
export interface Limits {
  /** Largest Markdown file, in bytes. */
  maxFileBytes: number
  /** Largest idea (all its Markdown together), in bytes. */
  maxIdeaBytes: number
  draft: DraftLimits
}

/**
 * A live draft's (docs/handoff-live-editing.md): what the hardware can take, so they're settings.
 * The default for `editors` comes from the draft crowd load test (packages/load/src/draft-crowd.ts).
 */
export interface DraftLimits {
  /** The most windows editing one draft at once; past it, a window opens it read-only, still live. */
  editors: number
  /** How often, at most, a window sends where its caret is, in milliseconds. */
  caretMs: number
  /** How many of a file's steps are kept for catching up, at least: this many, or keepMinutes, whichever keeps more. */
  keepSteps: number
  /** How long a file's steps are kept for catching up, in minutes. */
  keepMinutes: number
  /** How often a file's document is stored whole, in steps: waking up replays at most this many. */
  snapshotEvery: number
  /** How long the draft is quiet before a restore point is kept, in minutes. */
  restoreQuietMinutes: number
  /** How much of the draft's restore points an idea keeps, in MB: past it, the oldest are dropped. */
  restoreKeepMb: number
}

export const DEFAULT_DRAFT_LIMITS: DraftLimits = {
  editors: 20,
  caretMs: 80,
  keepSteps: 2000,
  keepMinutes: 10,
  snapshotEvery: 200,
  restoreQuietMinutes: 5,
  restoreKeepMb: 50,
}

export const DEFAULT_LIMITS: Limits = {
  maxFileBytes: 256 * 1024,
  maxIdeaBytes: 2 * 1024 * 1024,
  draft: DEFAULT_DRAFT_LIMITS,
}
export const LIMIT_RANGES = {
  maxFileBytes: { min: 16 * 1024, max: 1024 * 1024 },
  maxIdeaBytes: { min: 256 * 1024, max: 4 * 1024 * 1024 },
  draft: {
    editors: { min: 1, max: 1000 },
    caretMs: { min: 16, max: 2000 },
    keepSteps: { min: 100, max: 1_000_000 },
    keepMinutes: { min: 1, max: 7 * 24 * 60 },
    snapshotEvery: { min: 10, max: 100_000 },
    restoreQuietMinutes: { min: 1, max: 24 * 60 },
    restoreKeepMb: { min: 1, max: 10_000 },
  },
} as const

/**
 * The most a request, or a call to an actor and its answer, may carry: four
 * times the largest idea a site may allow, room for its encoding (JSON, CBOR)
 * and what comes with the files. An upload carries its files to the idea's
 * actor and a pull carries them back, so RivetKit's message limits (64 KB in
 * and 1 MB out by default) must allow it too, or bigger ideas fail.
 */
export const MAX_MESSAGE_BYTES = 4 * LIMIT_RANGES.maxIdeaBytes.max

/** The limits in the settings (limits.max_file_bytes, max_idea_bytes and draft.*, checked against LIMIT_RANGES there). */
export const limitsFrom = (limits: {
  max_file_bytes: number
  max_idea_bytes: number
  draft: {
    editors: number
    caret_ms: number
    keep_steps: number
    keep_minutes: number
    snapshot_every: number
    restore_quiet_minutes: number
    restore_keep_mb: number
  }
}): Limits => ({
  maxFileBytes: limits.max_file_bytes,
  maxIdeaBytes: limits.max_idea_bytes,
  draft: {
    editors: limits.draft.editors,
    caretMs: limits.draft.caret_ms,
    keepSteps: limits.draft.keep_steps,
    keepMinutes: limits.draft.keep_minutes,
    snapshotEvery: limits.draft.snapshot_every,
    restoreQuietMinutes: limits.draft.restore_quiet_minutes,
    restoreKeepMb: limits.draft.restore_keep_mb,
  },
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
