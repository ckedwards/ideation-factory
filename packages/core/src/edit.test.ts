// Editing a block in place: its new source becomes the smallest command, so
// comments on what didn't change keep their place.
import { describe, expect, test } from 'bun:test'
import { applyBatch } from './apply.ts'
import { blockEdit } from './edit.ts'
import { createIdea, type Idea, textAnchor } from './idea.ts'

const PLAN = `# Plan

The quick brown fox jumps over the lazy dog.

## Risks

- Weather
- Budget
`
// f1; s2 Plan, b3 its paragraph, s4 Risks, b5 Weather, b6 Budget

const plan = () => createIdea([{ path: 'plan.md', source: PLAN }])

function commands(idea: Idea, id: string, next: string) {
  const edit = blockEdit(idea, id, next)
  if (!edit.ok) {
    throw new Error(edit.message)
  }
  return edit.commands
}

describe('editing a block', () => {
  test('replaces only what changed, unique in the block', () => {
    expect(commands(plan(), 'b3', 'The quick red fox jumps over the lazy dog.')).toEqual([
      { command: 'replace', in: 'b3', old: 'brown', new: 'red' },
    ])
    // a word added: some text around it, so there's something to replace
    expect(commands(plan(), 'b3', 'The quick brown fox jumps right over the lazy dog.')).toEqual([
      { command: 'replace', in: 'b3', old: ' o', new: ' right o' },
    ])
  })

  test('keeps comments on the text that stayed exact', () => {
    const idea = plan()
    const comment = { id: 'c1', anchor: textAnchor(idea, 'f1', 'lazy dog') }
    const applied = applyBatch(idea, [comment], {
      base: 1,
      steps: commands(idea, 'b3', 'A quick brown fox jumps over the lazy dog.'),
    })
    if (!applied.ok) {
      throw new Error(JSON.stringify(applied.conflicts))
    }
    expect(applied.comments).toEqual([
      { id: 'c1', state: 'exact', anchor: expect.objectContaining({ quote: 'lazy dog' }) },
    ])
  })

  test('nothing changed is no command; emptied is a delete', () => {
    expect(commands(plan(), 'b5', '- Weather\n')).toEqual([])
    expect(commands(plan(), 'b5', '  ')).toEqual([{ command: 'delete', target: 'b5', expect: '- Weather' }])
  })

  test('a list item is edited with its marker', () => {
    const idea = plan()
    const applied = applyBatch(idea, [], { base: 1, steps: commands(idea, 'b6', '- Budget and staff') })
    expect(applied.ok && applied.idea.files[0]!.source).toContain('- Weather\n- Budget and staff\n')
  })
})

describe('editing a heading', () => {
  test('renames it, with or without its #s', () => {
    expect(commands(plan(), 's4', 'Open risks')).toEqual([
      { command: 'rename-heading', target: 's4', title: 'Open risks', expect: '## Risks' },
    ])
    expect(commands(plan(), 's4', '## Risks')).toEqual([])
    // a new level from its #s; none keeps the level
    expect(commands(plan(), 's4', '### Risks')).toEqual([
      { command: 'rename-heading', target: 's4', title: 'Risks', level: 3, expect: '## Risks' },
    ])
    expect(commands(plan(), 's4', '# Open risks')).toEqual([
      { command: 'rename-heading', target: 's4', title: 'Open risks', level: 1, expect: '## Risks' },
    ])
    expect(blockEdit(plan(), 's4', 'Two\nlines')).toEqual({ ok: false, message: 'a heading is one line of text' })
  })
})
