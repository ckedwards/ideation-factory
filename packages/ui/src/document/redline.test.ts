/// <reference types="bun" />
// The redline's blocks, from two versions of a file.
import { describe, expect, test } from 'bun:test'
import { markdownTree } from '@ideaf/core'
import { changedRanges, redline, type RedlineBlock } from './redline.ts'

const file = (source: string) => ({ source, tree: markdownTree(source) })

/** Each block as kind and text, with an edit's words: "+inserted" and "-deleted". */
function summary(base: string, current: string, sameImages?: Parameters<typeof redline>[2]) {
  const before = file(base)
  const after = file(current)
  return redline(before, after, sameImages).map((block: RedlineBlock) => {
    const from = block.kind === 'removed' || block.kind === 'moved-from' ? before.source : after.source
    const text = from.slice(block.node.position!.start.offset, block.node.position!.end.offset)
    if (block.kind === 'edited') {
      return {
        kind: block.kind,
        inserted: block.inserted.map((range) => after.source.slice(range.start, range.end)),
        deleted: block.deleted.map((deletion) => deletion.text),
      }
    }
    return block.kind === 'moved-from'
      ? { kind: block.kind, label: block.label, down: block.down }
      : { kind: block.kind, text }
  })
}

describe('the redline', () => {
  test('unchanged blocks are the same; an edit shows its words', () => {
    expect(summary('# Sync\n\nThe app keeps changes.\n', '# Sync\n\nThe app keeps every change.\n')).toEqual([
      { kind: 'same', text: '# Sync' },
      { kind: 'edited', inserted: ['every change'], deleted: ['changes'] },
    ])
  })

  test('changes a space or one word apart read as one change, not words run together', () => {
    // "a week" to "every two weeks" was "a"→"every two", " ", "week"→"weeks": ~~a~~every two ~~week~~weeks
    expect(summary('Move one type a week.\n', 'Move one type every two weeks.\n')).toEqual([
      { kind: 'edited', inserted: ['every two weeks'], deleted: ['a week'] },
    ])
    // one unchanged word between two changes joins them too
    expect(
      summary('Ship the fast path to every team this week.\n', 'Ship a fast road to every team this week.\n'),
    ).toEqual([{ kind: 'edited', inserted: ['a fast road'], deleted: ['the fast path'] }])
    // two unchanged words keep them apart
    expect(summary('Ship it to every team now.\n', 'Ship them to every team today.\n')).toEqual([
      { kind: 'edited', inserted: ['them', 'today'], deleted: ['it', 'now'] },
    ])
  })

  test('a deletion shows the words a reader saw, not the Markdown around them', () => {
    expect(summary('Ship it **soon**, to everyone.\n', 'Ship it to everyone.\n')).toEqual([
      { kind: 'edited', inserted: [], deleted: ['soon, '] },
    ])
  })

  test('blocks added and removed', () => {
    expect(summary('One.\n\nTwo.\n', 'One.\n\nThree is new.\n\nTwo.\n')).toEqual([
      { kind: 'same', text: 'One.' },
      { kind: 'added', text: 'Three is new.' },
      { kind: 'same', text: 'Two.' },
    ])
    expect(summary('One.\n\nTwo.\n', 'Two.\n')).toEqual([
      { kind: 'removed', text: 'One.' },
      { kind: 'same', text: 'Two.' },
    ])
  })

  test('a block rewritten past recognition is removed and added, not a wall of word changes', () => {
    expect(summary('The server keeps both.\n', 'Nobody decides anything here at all.\n')).toEqual([
      { kind: 'removed', text: 'The server keeps both.' },
      { kind: 'added', text: 'Nobody decides anything here at all.' },
    ])
  })

  test('code and tables are compared whole', () => {
    expect(summary('```ts\nPOST /sync\n```\n', '```ts\nPOST /v2/sync\n```\n').map((b) => b.kind)).toEqual([
      'removed',
      'added',
    ])
  })

  test('a block that moved is marked where it went and where it was, not removed and added', () => {
    const base = '## Rollout\n\nShip behind a flag.\n\n## Risks\n\nConflicts may rise.\n'
    const current = '## Risks\n\nConflicts may rise.\n\n## Rollout\n\nShip behind a flag.\n'
    const blocks = summary(base, current)
    expect(blocks.filter((b) => b.kind === 'moved-from').length).toBeGreaterThan(0)
    expect(blocks.filter((b) => b.kind === 'moved').length).toBe(blocks.filter((b) => b.kind === 'moved-from').length)
    expect(blocks.some((b) => b.kind === 'removed' || b.kind === 'added')).toBe(false)
  })

  test('the same Markdown with a different image shows before and after', () => {
    const source = 'The flow:\n\n![Sync flow](img/flow.svg)\n'
    expect(summary(source, source, () => false).map((b) => b.kind)).toEqual(['image-changed', 'image-changed'])
    expect(summary(source, source).map((b) => b.kind)).toEqual(['same', 'same'])
  })

  test('the changed ranges are the newer file’s changed blocks', () => {
    const current = 'One.\n\nTwo, edited.\n'
    const ranges = changedRanges(redline(file('One.\n\nTwo.\n'), file(current)))
    expect(ranges.map((range) => current.slice(range.start, range.end))).toEqual(['Two, edited.'])
  })
})

describe('deletions', () => {
  test('one after the last word of a paragraph is placed at the end of its text', () => {
    const current = 'When two people change the same field, the server keeps both.\n'
    const [block] = redline(
      file('When two people change the same field, the server keeps both. It loses work.\n'),
      file(current),
    )
    expect(block?.kind).toBe('edited')
    const deleted = block?.kind === 'edited' ? block.deleted : []
    expect(deleted.map((d) => d.text.trim())).toEqual(['It loses work.'])
    expect(deleted[0]!.at).toBeLessThanOrEqual(current.indexOf('\n'))
  })
})
