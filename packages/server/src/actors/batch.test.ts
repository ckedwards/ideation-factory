import { expect, test } from 'bun:test'
import { batcher } from './batch.ts'

test('calls made together share a batch, and each gets its own result', async () => {
  const batches: number[][] = []
  const double = batcher(
    async (items: number[]) => {
      batches.push(items)
      return items.map((n) => n * 2)
    },
    { max: 50, waiting: 1000 },
  )
  expect(await Promise.all([double(1), double(2), double(3)])).toEqual([2, 4, 6])
  expect(batches).toEqual([[1, 2, 3]])
})

test('calls arriving while a batch is applied wait for the next, which takes up to max of them', async () => {
  const batches: number[][] = []
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  const echo = batcher(
    async (items: number[]) => {
      batches.push(items)
      if (batches.length === 1) {
        await held
      }
      return items
    },
    { max: 2, waiting: 1000 },
  )
  const first = echo(0)
  await Bun.sleep(1)
  const later = [echo(1), echo(2), echo(3)]
  release()
  expect(await Promise.all([first, ...later])).toEqual([0, 1, 2, 3])
  expect(batches).toEqual([[0], [1, 2], [3]])
})

test('a batch that fails fails each of its calls, and the next batch still runs', async () => {
  let n = 0
  const flaky = batcher(
    async (items: string[]) => {
      if (n++ === 0) {
        throw new Error('storage busy')
      }
      return items
    },
    { max: 50, waiting: 1000 },
  )
  await expect(flaky('a')).rejects.toThrow('storage busy')
  expect(await flaky('b')).toBe('b')
})

test('past the most waiting, a call is refused as busy', async () => {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  const slow = batcher(
    async (items: number[]) => {
      await held
      return items
    },
    { max: 1, waiting: 2 },
  )
  const running = slow(0)
  await Bun.sleep(1)
  const waiting = [slow(1), slow(2)]
  await expect(slow(3)).rejects.toMatchObject({ code: 'busy' })
  release()
  expect(await Promise.all([running, ...waiting])).toEqual([0, 1, 2])
})
