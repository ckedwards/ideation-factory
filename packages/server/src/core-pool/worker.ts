// A core worker: runs one call at a time, sent by WorkerPool.
import { core, type CoreMethod } from './runner.ts'

declare const self: Worker

self.onmessage = (event: MessageEvent<{ id: number; method: CoreMethod; args: unknown[] }>) => {
  const { id, method, args } = event.data
  try {
    const result = (core[method] as (...a: unknown[]) => unknown)(...args)
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  }
}
