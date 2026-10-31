import { expect, test } from 'bun:test'
import { Batch, batchJsonSchema } from './batch.ts'

test('a valid batch parses', () => {
  const batch: Batch = {
    base: 4,
    steps: [
      { command: 'replace', in: 'b12', old: 'brown', new: 'red', addresses: ['c3'] },
      { command: 'move', target: 's4', to: { after: 's8' } },
      { command: 'insert', at: { end: 'f1' }, markdown: 'New.' },
    ],
  }
  expect(Batch.parse(batch)).toEqual(batch)
})

test('unknown commands, unknown fields and bad IDs are refused', () => {
  expect(Batch.safeParse({ base: 1, steps: [{ command: 'rewrite', target: 'b1' }] }).success).toBe(false)
  expect(Batch.safeParse({ base: 1, steps: [{ command: 'delete', target: 'b1', extra: true }] }).success).toBe(false)
  expect(Batch.safeParse({ base: 1, steps: [{ command: 'delete', target: 'f1' }] }).success).toBe(false)
  expect(Batch.safeParse({ base: 1, steps: [{ command: 'rename-heading', target: 'b1', title: 'x' }] }).success).toBe(
    false,
  )
  expect(Batch.safeParse({ base: 1, steps: [] }).success).toBe(false)
})

test('the format is published as JSON Schema', () => {
  const schema = batchJsonSchema() as { properties: { steps: { items: { oneOf?: unknown[]; anyOf?: unknown[] } } } }
  const variants = schema.properties.steps.items.oneOf ?? schema.properties.steps.items.anyOf
  expect(variants).toHaveLength(9)
})
