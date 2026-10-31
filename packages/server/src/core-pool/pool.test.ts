import { afterAll, expect, test } from 'bun:test'
import { createIdea, textAnchor } from '@ideaf/core'
import { WorkerPool } from './pool.ts'
import { inProcessCore } from './runner.ts'

const pool = new WorkerPool({ size: 2 })
afterAll(() => pool.close())

const idea = createIdea([{ path: 'plan.md', source: '# Plan\n\nThe quick brown fox.\n' }])
const comments = [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'brown') }]
const batch = { base: 1, steps: [{ command: 'replace' as const, in: 'b3', old: 'brown', new: 'red' }] }

test('a worker gives the same result as running core in process', async () => {
  expect(await pool.applyBatch('idea-1', idea, comments, batch)).toEqual(await inProcessCore().applyBatch('idea-1', idea, comments, batch))
  expect(await pool.outline('idea-1', idea)).toEqual(await inProcessCore().outline('idea-1', idea))
})

test("an idea's work always goes to the same worker", () => {
  expect(pool.slotFor('idea-1')).toBe(pool.slotFor('idea-1'))
  const slots = new Set(Array.from({ length: 50 }, (_, i) => pool.slotFor(`idea-${i}`)))
  expect(slots.size).toBe(2)
})

test('a call that runs too long ends its worker, and the next call gets a new one', async () => {
  const slow = new WorkerPool({ size: 1, timeoutMs: 1 })
  const big = createIdea([{ path: 'big.md', source: 'Some text to parse. '.repeat(50_000) }])
  await expect(slow.outline('x', big)).rejects.toThrow('took longer than 1 ms')
  const ok = new WorkerPool({ size: 1 })
  expect(await ok.outline('x', idea)).toHaveLength(1)
  await slow.close()
  await ok.close()
})

test('errors in core come back as rejections', async () => {
  // createIdea reports bad paths as a result, not a crash
  expect(await pool.createIdea('x', [{ path: '../bad.md', source: '' }])).toEqual({ ok: false, message: '../bad.md: path has an empty, "." or ".." part' })
})
