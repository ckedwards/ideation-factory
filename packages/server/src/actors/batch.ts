// Calls gathered into batches, each applied in one go: what a queue's
// nextBatch did for an actor, for its actions (RivetKit 3.0 deprecates queues,
// and actions run at once, interleaving at every await). A call waits for its
// batch, which starts as soon as the one before it is done: alone when the
// actor is idle, so nothing waits on a timer, and as many as have arrived, up to
// `max`, when it's busy. Each call is answered with its own result, or with the
// error its batch failed with, for the caller to retry.
import { UserError } from 'rivetkit'

export interface BatchOptions {
  /** The most a batch applies at once. */
  max: number
  /** The most calls waiting for a batch: past it, a call is refused as busy, for the caller to retry. */
  waiting: number
}

export function batcher<T, R>(apply: (items: T[]) => Promise<R[]>, options: BatchOptions): (item: T) => Promise<R> {
  const pending: Array<{ item: T; resolve: (result: R) => void; reject: (error: unknown) => void }> = []
  let draining = false
  const drain = async () => {
    draining = true
    try {
      while (pending.length > 0) {
        const batch = pending.splice(0, options.max)
        try {
          const results = await apply(batch.map((call) => call.item))
          batch.forEach((call, i) => call.resolve(results[i]!))
        } catch (error) {
          for (const call of batch) {
            call.reject(error)
          }
        }
      }
    } finally {
      draining = false
    }
  }
  return (item) => {
    if (pending.length >= options.waiting) {
      return Promise.reject(new UserError('too many calls are waiting; try again shortly', { code: 'busy' }))
    }
    return new Promise<R>((resolve, reject) => {
      pending.push({ item, resolve, reject })
      if (!draining) {
        // after this turn, so calls made together share the first batch
        draining = true
        queueMicrotask(() => void drain())
      }
    })
  }
}
