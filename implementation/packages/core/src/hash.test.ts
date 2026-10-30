import { describe, expect, test } from 'bun:test'
import { contentHash } from './hash.ts'

describe('contentHash', () => {
  test('is SHA-256 of the raw bytes, as hex', async () => {
    // the standard test vector for "abc"
    expect(await contentHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  test('treats a string as its UTF-8 bytes', async () => {
    expect(await contentHash('é')).toBe(await contentHash(new Uint8Array([0xc3, 0xa9])))
  })
})
