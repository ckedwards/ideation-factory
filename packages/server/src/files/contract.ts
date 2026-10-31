// The tests every FileStore implementation must pass. Each implementation's
// test file calls fileStoreContract with a way to make an empty store.
import { describe, expect, test } from 'bun:test'
import { contentHash } from '@ideaf/core'
import type { FileStore } from './store.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

export function fileStoreContract(name: string, make: () => Promise<FileStore>): void {
  describe(`${name} (FileStore contract)`, () => {
    test('stores by content hash and reads back the same bytes', async () => {
      const store = await make()
      const content = bytes('# An idea\n\nWith a paragraph.\n')
      const hash = await store.put(content)
      expect(hash).toBe(await contentHash(content))
      expect(await store.has(hash)).toBe(true)
      expect(await store.get(hash)).toEqual(content)
    })

    test('a missing hash reads as null, and has() is false', async () => {
      const store = await make()
      const missing = await contentHash('never stored')
      expect(await store.get(missing)).toBeNull()
      expect(await store.has(missing)).toBe(false)
    })

    test('storing the same content twice returns the same hash and keeps one copy', async () => {
      const store = await make()
      const first = await store.put(bytes('same'))
      const second = await store.put(bytes('same'))
      expect(second).toBe(first)
      expect(await store.get(first)).toEqual(bytes('same'))
    })

    test('stores empty content and binary content', async () => {
      const store = await make()
      const empty = new Uint8Array(0)
      const binary = new Uint8Array([0, 255, 10, 13, 0xc3, 0x28])
      expect(await store.get(await store.put(empty))).toEqual(empty)
      expect(await store.get(await store.put(binary))).toEqual(binary)
    })

    test('changing the caller’s buffer after put does not change the stored file', async () => {
      const store = await make()
      const content = bytes('original')
      const hash = await store.put(content)
      content.fill(0)
      expect(await store.get(hash)).toEqual(bytes('original'))
    })

    test('refuses anything that is not a content hash', async () => {
      const store = await make()
      for (const key of ['../etc/passwd', 'ABC', '', 'a'.repeat(63), 'A'.repeat(64)]) {
        await expect(store.get(key)).rejects.toThrow('not a content hash')
        await expect(store.has(key)).rejects.toThrow('not a content hash')
      }
    })
  })
}
