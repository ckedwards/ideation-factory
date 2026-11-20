import { describe, expect, test } from 'bun:test'
import type { ActorRef } from '../directory/types.ts'
import { publishedInboxEvents } from './notify.ts'

const by: ActorRef = { user: 'u1', bot: null, purpose: 'me' }

describe("an inbox row's excerpt", () => {
  test('reads as the comment does, without its Markdown', () => {
    const [comment, reply] = publishedInboxEvents(
      [
        {
          id: 'c1',
          parent: null,
          body: 'Use **`createIdea`**:\n\n- one\n- [two](https://example.com)',
          suggestion: null,
          quote: null,
        },
        { id: 'c2', parent: 'c1', body: '> agreed', suggestion: null, quote: null },
      ],
      by,
      1,
    )
    expect(comment!.detail['body']).toBe('Use createIdea: one two')
    expect(reply!.detail['body']).toBe('agreed')
  })

  test('is cut short', () => {
    const [comment] = publishedInboxEvents(
      [{ id: 'c1', parent: null, body: `**${'word '.repeat(60).trim()}**`, suggestion: null, quote: null }],
      by,
      1,
    )
    const excerpt = comment!.detail['body'] as string
    expect(excerpt).toHaveLength(141)
    expect(excerpt).toStartWith('word word')
    expect(excerpt).toEndWith('…')
    expect(excerpt).not.toContain('*')
  })
})
