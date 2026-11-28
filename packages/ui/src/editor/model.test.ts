// The page codec (model.ts): a file opened as a document, and written back as Markdown.
import { expect, test } from 'bun:test'
import { pageDocument, Transform } from './model.ts'

test('an empty file opens as the one empty line a document needs, and writes back empty', async () => {
  const { codec, doc } = await pageDocument('', [])
  expect(doc.childCount).toBe(1)
  expect(codec.write(doc)).toBe('')
})

test('an empty line between blocks is still written as one', async () => {
  const { schema, codec, doc } = await pageDocument('First.\n', ['b1'])
  const tr = new Transform(doc).insert(doc.content.size, schema.nodes['paragraph']!.create())
  tr.insert(tr.doc.content.size, schema.nodes['paragraph']!.create(null, schema.text('Second.')))
  expect(codec.write(tr.doc)).toBe('First.\n\n<br />\n\nSecond.')
})

test('a file emptied of its text writes back empty', async () => {
  const { schema, codec, doc } = await pageDocument('First.\n', ['b1'])
  const tr = new Transform(doc).replaceWith(0, doc.content.size, schema.nodes['paragraph']!.create())
  expect(codec.write(tr.doc)).toBe('')
})
