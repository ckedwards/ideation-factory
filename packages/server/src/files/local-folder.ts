import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { contentHash } from '@ideaf/core'
import { assertContentHash, type FileStore } from './store.ts'

/**
 * Keeps files in a local folder, for development: `<root>/<first two hex>/<hash>`.
 * Each file is written to a temporary name and then renamed, so a reader never
 * sees a partly written file.
 */
export class LocalFolderFileStore implements FileStore {
  constructor(readonly root: string) {}

  #path(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash)
  }

  async put(content: Uint8Array<ArrayBuffer>): Promise<string> {
    const hash = await contentHash(content)
    if (await this.has(hash)) return hash
    const path = this.#path(hash)
    await mkdir(join(this.root, hash.slice(0, 2)), { recursive: true })
    const temporary = `${path}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, content)
    await rename(temporary, path)
    return hash
  }

  async get(hash: string): Promise<Uint8Array<ArrayBuffer> | null> {
    assertContentHash(hash)
    try {
      const buffer = await readFile(this.#path(hash))
      return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async has(hash: string): Promise<boolean> {
    assertContentHash(hash)
    try {
      return (await stat(this.#path(hash))).isFile()
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT'
}
