// The live document's status as a page hears it (live.ts): a long gap, and opened again after it.
import { expect, test } from 'bun:test'
import { LiveDoc, type LiveStatus } from './live.ts'
import { pageDocument } from './model.ts'

test('opened again after a long gap, the page is told it’s saved', async () => {
  const { doc } = await pageDocument('# Plan\n\nShip it.\n', ['b1', 'b2'])
  const live = new LiveDoc({ doc: doc.toJSON(), version: 3 }, { send: () => {}, since: () => {} })
  const heard: LiveStatus[] = []
  live.subscribe((status) => heard.push(status))
  live.gone()
  live.reset({ doc: doc.toJSON(), version: 40 })
  expect(heard).toEqual(['gone', 'saved'])
  expect(live.status()).toBe('saved')
  expect(live.version()).toBe(40)
})
