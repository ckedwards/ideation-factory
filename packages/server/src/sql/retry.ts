// Retrying when the engine's storage is busy. Rivet Engine 3.0 refuses an
// actor's write when its storage lane is full ("sqlite storage is overloaded,
// retry after 500 ms: volume write refused before dispatch"): the write never
// reached storage, and the engine says when to try again. Without a retry, a
// request that lands in that window (usually well under a second) fails.
//
// A statement on its own is retried as is; a transaction is retried whole,
// so its callback must only touch the database (true of the directory's and
// the idea service's). Statements inside a transaction aren't retried one by
// one: the transaction is.
import type { Sql } from './sql.ts'

const OVERLOADED = /storage is overloaded, retry after (\d+) ?ms/

/** How long the engine asks us to wait, when this error is its storage being busy; null for any other error. */
export function overloadedRetryMs(error: unknown): number | null {
  const parts: unknown[] = [error instanceof Error ? error.message : error]
  if (error && typeof error === 'object' && 'metadata' in error) {
    const metadata = (error as { metadata?: unknown }).metadata
    parts.push(metadata && typeof metadata === 'object' && 'error' in metadata ? metadata.error : metadata)
  }
  for (const part of parts) {
    const match = typeof part === 'string' ? OVERLOADED.exec(part) : null
    if (match) {
      return Number(match[1])
    }
  }
  return null
}

export interface RetryOptions {
  /** Give up once this much time has been spent waiting (default 10 s). */
  maxWaitMs?: number
  /** Whether transactions are retried whole (default true); false passes them through, for callers whose transactions do more than touch the database. */
  transactions?: boolean
  onRetry?: (waitMs: number, error: unknown) => void
  sleep?: (ms: number) => Promise<void>
}

export function retryOverloaded(sql: Sql, options: RetryOptions = {}): Sql {
  const maxWaitMs = options.maxWaitMs ?? 10_000
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms))
  const retrying = async <T>(run: () => Promise<T>): Promise<T> => {
    let waited = 0
    for (;;) {
      try {
        return await run()
      } catch (error) {
        const asked = overloadedRetryMs(error)
        if (asked === null || waited >= maxWaitMs) {
          throw error
        }
        // what the engine asks, within reason, and never past the limit
        const wait = Math.min(Math.max(asked, 50), 2_000, maxWaitMs - waited)
        options.onRetry?.(wait, error)
        await sleep(wait)
        waited += wait
      }
    }
  }
  return {
    execute: (query, ...args) => retrying(() => sql.execute(query, ...args)),
    transaction: (callback) =>
      options.transactions === false ? sql.transaction(callback) : retrying(() => sql.transaction(callback)),
  }
}

/**
 * Whether a call to another actor failed in a way worth trying again. Its
 * storage being busy reaches the caller only as RivetKit's generic internal
 * error (the detail stays with the actor), so that's retried too: only for
 * calls that are safe to repeat (an index update, a notification with its ID).
 */
export function retryableCall(error: unknown): boolean {
  if (overloadedRetryMs(error) !== null) {
    return true
  }
  const e = error as { group?: unknown; code?: unknown } | null
  return typeof e === 'object' && e !== null && e.group === 'core' && e.code === 'internal_error'
}

/** Calls another actor, trying again (every 500 ms, up to `maxWaitMs`, default 10 s) while it fails retryably. */
export async function callRetrying<T>(
  run: () => Promise<T>,
  options: { maxWaitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const maxWaitMs = options.maxWaitMs ?? 10_000
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms))
  let waited = 0
  for (;;) {
    try {
      return await run()
    } catch (error) {
      if (!retryableCall(error) || waited >= maxWaitMs) {
        throw error
      }
      const wait = Math.min(overloadedRetryMs(error) ?? 500, 2_000, maxWaitMs - waited)
      await sleep(wait)
      waited += wait
    }
  }
}
