// A pool of Bun worker threads for core. Each idea's work always goes to the
// same worker (by a hash of its key), which keeps calls for one idea in order
// and lets that worker's parse cache hold the idea's latest version. A call
// that takes longer than the timeout ends its worker (which is replaced), so a
// pathological input can't wedge the pool.
import type { CoreMethod, CoreRunner } from './runner.ts'

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: Timer }
type Slot = { worker: Worker; pending: Map<number, Pending> }

export interface PoolOptions {
  /** Number of workers. Default: one fewer than the CPUs, between 1 and 4. */
  size?: number
  /** Longest a single call may run, in milliseconds. Default 30 s. */
  timeoutMs?: number
}

export class WorkerPool implements CoreRunner {
  readonly #slots: Array<Slot | null>
  readonly #timeoutMs: number
  #nextId = 1
  #closed = false

  constructor(options: PoolOptions = {}) {
    const cpus = navigator.hardwareConcurrency || 2
    const size = options.size ?? Math.min(4, Math.max(1, cpus - 1))
    this.#slots = Array.from({ length: size }, () => null)
    this.#timeoutMs = options.timeoutMs ?? 30_000
  }

  get size(): number {
    return this.#slots.length
  }

  applyBatch: CoreRunner['applyBatch'] = (key, ...args) => this.#call(key, 'applyBatch', args) as never
  applyUpload: CoreRunner['applyUpload'] = (key, ...args) => this.#call(key, 'applyUpload', args) as never
  outline: CoreRunner['outline'] = (key, ...args) => this.#call(key, 'outline', args) as never
  createIdea: CoreRunner['createIdea'] = (key, ...args) => this.#call(key, 'createIdea', args) as never
  checkAnchor: CoreRunner['checkAnchor'] = (key, ...args) => this.#call(key, 'checkAnchor', args) as never
  suggestionSource: CoreRunner['suggestionSource'] = (key, ...args) =>
    this.#call(key, 'suggestionSource', args) as never
  buildDraft: CoreRunner['buildDraft'] = (key, ...args) => this.#call(key, 'buildDraft', args) as never
  draftChanges: CoreRunner['draftChanges'] = (key, ...args) => this.#call(key, 'draftChanges', args) as never

  async close(): Promise<void> {
    this.#closed = true
    this.#slots.forEach((slot, i) => {
      if (slot) {
        this.#retire(i, new Error('worker pool closed'))
      }
    })
  }

  /** Which worker an idea's work goes to. */
  slotFor(key: string): number {
    let hash = 2166136261
    for (let i = 0; i < key.length; i++) {
      hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
    }
    return (hash >>> 0) % this.#slots.length
  }

  #call(key: string, method: CoreMethod, args: unknown[]): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new Error('worker pool closed'))
    }
    const index = this.slotFor(key)
    const slot = this.#slot(index)
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#retire(index, new Error(`core ${method} took longer than ${this.#timeoutMs} ms`))
      }, this.#timeoutMs)
      slot.pending.set(id, { resolve, reject, timer })
      slot.worker.postMessage({ id, method, args })
    })
  }

  #slot(index: number): Slot {
    const existing = this.#slots[index]
    if (existing) {
      return existing
    }
    const worker = new Worker(new URL('./worker.ts', import.meta.url).href)
    const slot: Slot = { worker, pending: new Map() }
    worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const pending = slot.pending.get(event.data.id)
      if (!pending) {
        return
      }
      slot.pending.delete(event.data.id)
      clearTimeout(pending.timer)
      if (event.data.error !== undefined) {
        pending.reject(new Error(event.data.error))
      } else {
        pending.resolve(event.data.result)
      }
    }
    worker.onerror = (event) => this.#retire(index, new Error(`core worker failed: ${event.message}`))
    // don't keep the process alive just for idle workers
    worker.unref()
    this.#slots[index] = slot
    return slot
  }

  /** Ends a worker and fails its calls; the next call to that slot starts a new one. */
  #retire(index: number, error: Error): void {
    const slot = this.#slots[index]
    if (!slot) {
      return
    }
    this.#slots[index] = null
    slot.worker.terminate()
    for (const pending of slot.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    slot.pending.clear()
  }
}
