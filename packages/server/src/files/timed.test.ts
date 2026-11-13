import { expect, test } from 'bun:test'
import { contentHash } from '@ideaf/core'
import { MemoryFileStore } from './memory.ts'
import { timedFileStore } from './timed.ts'

test('a summary of the reads and writes since the last, then nothing until there are more', async () => {
  const lines: string[] = []
  const store = timedFileStore(new MemoryFileStore(), { everyMs: 3_600_000, log: (line) => lines.push(line) })
  const hash = await store.put(new TextEncoder().encode('content'))
  await store.has(hash)
  await store.get(hash)
  await store.get(hash)
  await store.get(await contentHash('missing'))
  store.report()
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatch(
    /^file store, the last \d+ s: 3 reads, p50 [\d.]+ ms, p95 [\d.]+ ms, \d+ ms in all; 2 writes, /,
  )
  // nothing since: nothing logged
  store.report()
  expect(lines).toHaveLength(1)
  store.stop()
})

test('it passes everything through unchanged, failures too', async () => {
  const inner = new MemoryFileStore()
  const store = timedFileStore(inner, { everyMs: 3_600_000, log: () => {} })
  const bytes = new TextEncoder().encode('same bytes')
  const hash = await store.put(bytes)
  expect(await store.get(hash)).toEqual(bytes)
  expect(await store.has(hash)).toBe(true)
  await expect(store.get('not a hash')).rejects.toThrow('not a content hash')
  store.stop()
})
