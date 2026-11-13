// How long the file store takes, logged once a minute while it's used: how
// much of an idea page goes on reading its files (on S3, a request each),
// which decides whether a file cache is worth having. A summary, not a line
// per call: reads and writes, their p50 and p95, and the time in all.
import type { FileStore } from './store.ts'

/** The most calls a minute's percentiles are taken from (a uniform sample of them). */
const SAMPLE = 5_000

export interface TimedFileStore extends FileStore {
  /** Logs the calls since the last summary, if there were any, and starts afresh. */
  report(): void
  /** Stops the once-a-minute summary. */
  stop(): void
}

export function timedFileStore(
  store: FileStore,
  options: { everyMs?: number; log?: (line: string) => void } = {},
): TimedFileStore {
  const log = options.log ?? ((line: string) => console.log(line))
  const kinds = { read: newTally(), write: newTally() }
  const time = async <T>(tally: Tally, call: () => Promise<T>): Promise<T> => {
    const start = performance.now()
    try {
      return await call()
    } finally {
      tally.add(performance.now() - start)
    }
  }
  const report = () => {
    const parts = Object.entries(kinds)
      .filter(([, tally]) => tally.count > 0)
      .map(
        ([kind, tally]) =>
          `${tally.count} ${kind}s, p50 ${tally.p(0.5)} ms, p95 ${tally.p(0.95)} ms, ${Math.round(tally.total)} ms in all`,
      )
    if (parts.length > 0) {
      log(`file store, the last ${Math.round((Date.now() - since) / 1000)} s: ${parts.join('; ')}`)
    }
    kinds.read = newTally()
    kinds.write = newTally()
    since = Date.now()
  }
  let since = Date.now()
  const timer = setInterval(report, options.everyMs ?? 60_000)
  timer.unref?.()
  return {
    // a read is get(); has() comes before a put (whether there's anything to store), so it counts as writing
    get: (hash) => time(kinds.read, () => store.get(hash)),
    has: (hash) => time(kinds.write, () => store.has(hash)),
    put: (content) => time(kinds.write, () => store.put(content)),
    report,
    stop: () => clearInterval(timer),
  }
}

interface Tally {
  count: number
  total: number
  add(ms: number): void
  p(q: number): number
}

function newTally(): Tally {
  const sample: number[] = []
  return {
    count: 0,
    total: 0,
    add(ms) {
      this.count++
      this.total += ms
      // a uniform sample of every call (reservoir sampling), so a busy minute costs no more memory
      if (sample.length < SAMPLE) {
        sample.push(ms)
      } else {
        const i = Math.floor(Math.random() * this.count)
        if (i < SAMPLE) {
          sample[i] = ms
        }
      }
    },
    p(q) {
      if (sample.length === 0) {
        return 0
      }
      const sorted = [...sample].sort((a, b) => a - b)
      return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! * 10) / 10
    },
  }
}
