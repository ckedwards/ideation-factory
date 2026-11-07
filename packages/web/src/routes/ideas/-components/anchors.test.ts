/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { markdownTree, parseMarkdown } from '@ideaf/core'
import { headings } from '@ideaf/ui'
import { headingOffset, sectionAt, toPlain, toSource } from './anchors.ts'

const source = `# Plan

Changes sync **oldest first**, in
one batch.

## Rollout

Ship behind a flag.
`
const plain = parseMarkdown(source).plain.text
const ids = parseMarkdown(source).units.map((_, i) => `u${i}`)

test('a comment on plain text marks the same words in the source, Markdown and line breaks included', () => {
  const at = plain.indexOf('oldest first, in one')
  const range = toSource(source, { start: at, end: at + 'oldest first, in one'.length })!
  expect(source.slice(range.start, range.end)).toBe('oldest first**, in\none')
})

test('a selection in the source is the same words in plain text, and back again', () => {
  const start = source.indexOf('oldest')
  const range = toPlain(source, { start, end: source.indexOf(' batch') })!
  expect(plain.slice(range.start, range.end)).toBe('oldest first, in one')
  expect(toSource(source, range)).toEqual({ start, end: source.indexOf(' batch') })
})

test('nothing to mark or comment on: past the end, or no text', () => {
  expect(toSource(source, { start: plain.length - 1, end: plain.length + 5 })).toBeNull()
  expect(toPlain(source, { start: source.indexOf('**oldest'), end: source.indexOf('oldest') })).toBeNull()
})

test("a section comment sits at its heading, where the document's headings start", () => {
  const rollout = headings(markdownTree(source)).find((h) => h.title === 'Rollout')!
  const id = sectionAt(source, ids, rollout.offset)!
  expect(id).not.toBeNull()
  expect(headingOffset(source, ids, id)).toBe(rollout.offset)
  // a paragraph's ID isn't a section
  expect(headingOffset(source, ids, 'u1')).toBeNull()
})
