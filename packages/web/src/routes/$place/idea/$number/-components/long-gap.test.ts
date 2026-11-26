import { describe, expect, test } from 'bun:test'
import type { DraftChange } from '@ideaf/core'
import type { Draft } from './editing.tsx'
import { needsALook, type Sent, sendEach } from './long-gap.ts'

// the draft now: someone else has changed b3 and taken b5 out
const now = {
  files: [
    {
      file: 'f1',
      units: [
        { id: 's2', source: '# Plan' },
        { id: 'b3', source: 'The slow brown fox.' },
        { id: 'b7', source: 'Their new line.' },
      ],
    },
  ],
} as unknown as Draft
const mine = [
  { id: 's2', source: '# Plan' },
  { id: 'b3', source: 'The quick red fox.' },
  { id: 'b5', source: 'It may pour.' },
]

describe('sending what was typed after a long gap', () => {
  const fox: DraftChange = { kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' }
  const rain: DraftChange = { kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' }
  const line: DraftChange = { kind: 'insert', at: { after: 's2' }, markdown: 'New.' }

  test('all at once when the draft takes them', async () => {
    const sent: DraftChange[][] = []
    const result = await sendEach([fox, line], async (changes) => {
      sent.push(changes)
      return 'taken'
    })
    expect(result).toEqual({ unsettled: [] })
    expect(sent).toEqual([[fox, line]])
  })

  test('one by one once one is refused, so what only you changed still goes in', async () => {
    const sent: DraftChange[][] = []
    const result = await sendEach([fox, rain, line], async (changes): Promise<Sent> => {
      sent.push(changes)
      return changes.includes(fox) || changes.includes(rain) ? 'outdated' : 'taken'
    })
    expect(result).toEqual({ unsettled: [fox, rain] })
    expect(sent).toEqual([[fox, rain, line], [fox], [rain], [line]])
  })

  test('stops at a failure that isn’t someone else’s change', async () => {
    const result = await sendEach([fox, line], async (changes): Promise<Sent> =>
      changes.length > 1 ? 'outdated' : changes[0] === fox ? 'taken' : { failed: 'offline' },
    )
    expect(result).toEqual({ failed: 'offline' })
  })
})

describe('a change someone else also made', () => {
  test('both changed: yours goes over theirs as the draft now reads', () => {
    const change: DraftChange = { kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' }
    expect(needsALook(change, now, 'f1', mine)).toEqual({
      what: 'You both changed this',
      yours: 'The quick red fox.',
      theirs: 'The slow brown fox.',
      over: { kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The slow brown fox.' },
    })
  })

  test('changed here and taken out there: yours goes back after the paragraph before it', () => {
    const change: DraftChange = { kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' }
    expect(needsALook(change, now, 'f1', mine)).toMatchObject({
      theirs: null,
      over: { kind: 'insert', at: { after: 'b3' }, markdown: 'It may pour.' },
    })
  })

  test('taken out here and changed there: yours takes it out', () => {
    const change: DraftChange = { kind: 'delete', id: 'b3', was: 'The quick brown fox.' }
    expect(needsALook(change, now, 'f1', mine)).toMatchObject({
      yours: '',
      theirs: 'The slow brown fox.',
      over: { kind: 'delete', id: 'b3', was: 'The slow brown fox.' },
    })
  })

  test('added after a paragraph that has gone: at the end of the file', () => {
    const change: DraftChange = { kind: 'insert', at: { after: 'b5' }, markdown: 'Later.' }
    expect(needsALook(change, now, 'f1', mine).over).toEqual({ kind: 'insert', at: { end: 'f1' }, markdown: 'Later.' })
  })
})
