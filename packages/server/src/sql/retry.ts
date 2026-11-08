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
