// Retrying when the engine's storage is busy: only that error, as long as it
// asks, within a limit; transactions whole, or not at all when told.
import { describe, expect, test } from 'bun:test'
import { callRetrying, overloadedRetryMs, retryableCall, retryOverloaded } from './retry.ts'
import type { Sql } from './sql.ts'

/** RivetKit's error for it: a generic message, the cause in its metadata. */
const busy = () =>
  Object.assign(new Error('An internal error occurred'), {
    metadata: {
      error:
        'actor x generation 0 key main\n\nCaused by:\n    sqlite storage is overloaded, retry after 500 ms: volume write refused before dispatch (reason=write_refused, retry_after_ms=500)',
    },
  })

/** A database that fails the first `failures` calls with `error`. */
function flaky(failures: number, error: () => unknown = busy) {
  const calls = { execute: 0, transaction: 0, callback: 0 }
  const sql: Sql = {
    async execute() {
      calls.execute++
      if (calls.execute <= failures) {
        throw error()
      }
      return [{ ok: 1 }] as never
    },
    async transaction(callback) {
      calls.transaction++
      const result = await callback(sql)
      if (calls.transaction <= failures) {
        throw error()
      }
      return result
    },
  }
  return { sql, calls }
}

describe('retrying when storage is busy', () => {
  test('recognizes the engine’s error, in its message or its metadata', () => {
    expect(overloadedRetryMs(busy())).toBe(500)
    expect(overloadedRetryMs(new Error('sqlite storage is overloaded, retry after 250 ms'))).toBe(250)
    expect(overloadedRetryMs(new Error('UNIQUE constraint failed'))).toBeNull()
    expect(overloadedRetryMs('nonsense')).toBeNull()
  })

  test('a statement waits as asked and tries again', async () => {
    const { sql, calls } = flaky(2)
    const waits: number[] = []
    const retried = retryOverloaded(sql, { sleep: async (ms) => void waits.push(ms) })
    expect(await retried.execute('select 1')).toEqual([{ ok: 1 }])
    expect(calls.execute).toBe(3)
    expect(waits).toEqual([500, 500])
  })

  test('a transaction is retried whole', async () => {
    const { sql, calls } = flaky(1)
    const retried = retryOverloaded(sql, { sleep: async () => {} })
    expect(
      await retried.transaction(async () => {
        calls.callback++
        return 'done'
      }),
    ).toBe('done')
    expect([calls.transaction, calls.callback]).toEqual([2, 2])
  })

  test('other errors, a transaction it’s told to leave alone, and a long overload go through', async () => {
    const constraint = flaky(1, () => new Error('UNIQUE constraint failed'))
    await expect(retryOverloaded(constraint.sql).execute('insert')).rejects.toThrow('UNIQUE')
    expect(constraint.calls.execute).toBe(1)

    const left = flaky(1)
    await expect(
      retryOverloaded(left.sql, { transactions: false, sleep: async () => {} }).transaction(async () => 1),
    ).rejects.toThrow('An internal error occurred')
    expect(left.calls.transaction).toBe(1)

    const long = flaky(100)
    const waits: number[] = []
    await expect(
      retryOverloaded(long.sql, { maxWaitMs: 1_200, sleep: async (ms) => void waits.push(ms) }).execute('select 1'),
    ).rejects.toThrow('An internal error occurred')
    expect(waits).toEqual([500, 500, 200])
  })
})

describe('calls to another actor', () => {
  // what a caller sees when the other actor's storage was busy: no detail
  const internal = () =>
    Object.assign(new Error('An internal error occurred'), { group: 'core', code: 'internal_error' })

  test('retry an internal error or a busy storage, nothing else', () => {
    expect(retryableCall(internal())).toBe(true)
    expect(retryableCall(busy())).toBe(true)
    expect(retryableCall(Object.assign(new Error('no'), { group: 'user', code: 'not_found' }))).toBe(false)
    expect(retryableCall(new Error('boom'))).toBe(false)
  })

  test('try again every 500 ms, then give up', async () => {
    let calls = 0
    const waits: number[] = []
    const sleep = async (ms: number) => void waits.push(ms)
    expect(
      await callRetrying(
        async () => {
          if (++calls < 3) {
            throw internal()
          }
          return 'sent'
        },
        { sleep },
      ),
    ).toBe('sent')
    expect(waits).toEqual([500, 500])
    await expect(
      callRetrying(
        async () => {
          throw internal()
        },
        { sleep, maxWaitMs: 1_000 },
      ),
    ).rejects.toThrow('An internal error occurred')
  })
})
