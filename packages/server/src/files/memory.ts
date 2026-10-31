import { contentHash } from '@ideaf/core'
import { assertContentHash, type FileStore } from './store.ts'

/** Keeps files in memory, for tests. */
export class MemoryFileStore implements FileStore {
  readonly #files = new Map<string, Uint8Array<ArrayBuffer>>()

  async put(content: Uint8Array<ArrayBuffer>): Promise<string> {
    const hash = await contentHash(content)
    // copy, so later changes to the caller's buffer can't change a stored file
    if (!this.#files.has(hash)) this.#files.set(hash, content.slice())
    return hash
  }

  async get(hash: string): Promise<Uint8Array<ArrayBuffer> | null> {
    assertContentHash(hash)
    return this.#files.get(hash)?.slice() ?? null
  }

  async has(hash: string): Promise<boolean> {
    assertContentHash(hash)
    return this.#files.has(hash)
  }
}
