// An idea's draft: changes built in order on the latest version, each checked
// against the draft as it is at that point.
import { describe, expect, test } from 'bun:test'
import { applyBatch } from './apply.ts'
import { buildDraft, type DraftChange, type DraftEntry, unitSource } from './draft.ts'
import { createIdea, textAnchor } from './idea.ts'

const PLAN = `# Plan

The quick brown fox.

## Risks

It might rain.

## Costs

Cheap.
`
// f1; s2 Plan, b3, s4 Risks, b5, s6 Costs, b7; next ID 8
const plan = () => createIdea([{ path: 'plan.md', source: PLAN }])
let n = 0
const entries = (...changes: DraftChange[]): DraftEntry[] => changes.map((change) => ({ key: `k${++n}`, change }))
const sourceOf = (draft: ReturnType<typeof buildDraft>) => draft.idea.files[0]!.source

describe('a draft', () => {
  test('with no changes is the latest version', () => {
    const draft = buildDraft(plan(), [], [])
    expect(sourceOf(draft)).toBe(PLAN)
    expect(draft.commands).toEqual([])
    expect(draft.files[0]!.units.every((u) => u.origin.kind === 'base' && !u.origin.changed)).toBe(true)
  })

  test('builds each change on the ones before it', () => {
    const idea = plan()
    const [first, second] = entries(
      { kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' },
      // made against the draft: the block as the first edit left it
      { kind: 'edit', id: 'b3', source: 'The slow red fox.', was: 'The quick red fox.' },
    )
    const draft = buildDraft(idea, [], [first!, second!])
    expect(draft.problems).toEqual({})
    expect(draft.commands).toEqual([
      { command: 'replace', in: 'b3', old: 'brown', new: 'red' },
      { command: 'replace', in: 'b3', old: 'quick', new: 'slow' },
    ])
    expect(draft.owners).toEqual([first!.key, second!.key])
    expect(draft.files[0]!.units.find((u) => u.id === 'b3')!.origin).toEqual({ kind: 'base', changed: true })
  })

  test('new text has the IDs committing gives it, and later changes name it', () => {
    const idea = plan()
    const changes = entries(
      { kind: 'insert', at: { after: 'b3' }, markdown: 'New text.' },
      { kind: 'edit', id: 'b8', source: 'Newer text.', was: 'New text.' },
      { kind: 'insert', at: { after: 'b8' }, markdown: 'Below it.' },
    )
    const draft = buildDraft(idea, [], changes)
    expect(sourceOf(draft)).toContain('The quick brown fox.\n\nNewer text.\n\nBelow it.\n\n## Risks')
    const units = draft.files[0]!.units
    expect(units.find((u) => u.source === 'Newer text.')).toMatchObject({
      id: 'b8',
      origin: { kind: 'new', change: changes[0]!.key },
    })
    // committing the same batch on the same version makes the same idea
    const committed = applyBatch(idea, [], { base: 1, steps: draft.commands })
    expect(committed.ok && committed.idea).toEqual(draft.idea)
  })

  test('a change to a block that reads differently now is outdated, and left out', () => {
    const idea = plan()
    const [stale, fine] = entries(
      { kind: 'edit', id: 'b3', source: 'x', was: 'Something else.' },
      { kind: 'delete', id: 'b5', was: 'It might rain.' },
    )
    const draft = buildDraft(idea, [], [stale!, fine!])
    expect(draft.problems).toEqual({ [stale!.key]: 'that block has changed since; undo this, and edit it again' })
    expect(draft.commands).toEqual([{ command: 'delete', target: 'b5', expect: 'It might rain.' }])
  })

  test('on a newer version, changes still apply or become outdated', () => {
    const changes = entries(
      { kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' },
      { kind: 'edit', id: 'b7', source: 'Cheap enough.', was: 'Cheap.' },
    )
    // someone else's version changed the fox
    const v1 = plan()
    const v2 = applyBatch(v1, [], {
      base: 1,
      steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }],
    })
    if (!v2.ok) {
      throw new Error('v2')
    }
    const draft = buildDraft(v2.idea, [], changes)
    expect(Object.keys(draft.problems)).toEqual([changes[0]!.key])
    expect(sourceOf(draft)).toContain('The slow brown fox.')
    expect(sourceOf(draft)).toContain('Cheap enough.')
  })

  test('deleting a section takes what was changed in it', () => {
    const changes = entries(
      { kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' },
      { kind: 'delete', id: 's4', was: '## Risks' },
    )
    expect(sourceOf(buildDraft(plan(), [], changes))).toBe('# Plan\n\nThe quick brown fox.\n\n## Costs\n\nCheap.\n')
  })
})

describe('suggestions in a draft', () => {
  test('find their text after earlier changes moved it, and address their comment', () => {
    const idea = plan()
    const comment = { id: 'c1', anchor: textAnchor(idea, 'f1', 'might rain') }
    const changes = entries(
      { kind: 'insert', at: { before: 'b5' }, markdown: 'Weather first.' },
      { kind: 'suggestion', comment: 'c1', old: 'might rain', new: 'may pour' },
    )
    const draft = buildDraft(idea, [comment], changes)
    expect(draft.problems).toEqual({})
    expect(sourceOf(draft)).toContain('Weather first.\n\nIt may pour.')
    expect(draft.commands[1]).toMatchObject({ command: 'replace', addresses: ['c1'] })
    expect(draft.comments).toEqual([
      { id: 'c1', state: 'changed', anchor: expect.objectContaining({ quote: 'may pour' }) },
    ])
  })

  test('is outdated once its text is gone from the draft', () => {
    const idea = plan()
    const comment = { id: 'c1', anchor: textAnchor(idea, 'f1', 'might rain') }
    const changes = entries(
      { kind: 'delete', id: 'b5', was: 'It might rain.' },
      { kind: 'suggestion', comment: 'c1', old: 'might rain', new: 'may pour' },
    )
    const draft = buildDraft(idea, [comment], changes)
    expect(draft.problems[changes[1]!.key]).toBe('its text is gone')
    expect(draft.comments[0]).toEqual({ id: 'c1', state: 'outdated', anchor: null })
  })
})

test('a unit’s source, by ID', () => {
  expect(unitSource(plan(), 's4')).toBe('## Risks')
  expect(unitSource(plan(), 'b99')).toBeNull()
})

describe('a move in the draft', () => {
  test('takes a block, or a section, to a new place with its comments', () => {
    const idea = plan()
    const comments = [
      { id: 'c1', anchor: textAnchor(idea, 'f1', 'quick brown') },
      { id: 'c2', anchor: { kind: 'section' as const, file: 'f1', section: 's6' } },
    ]
    const draft = buildDraft(
      idea,
      comments,
      entries(
        { kind: 'move', id: 'b3', to: { after: 'b5' }, was: 'The quick brown fox.' },
        { kind: 'move', id: 's6', to: { before: 's4' }, was: '## Costs' },
      ),
    )
    expect(draft.problems).toEqual({})
    expect(sourceOf(draft)).toBe('# Plan\n\n## Costs\n\nCheap.\n\n## Risks\n\nIt might rain.\n\nThe quick brown fox.\n')
    expect(draft.comments.map((c) => [c.id, c.state])).toEqual([
      ['c1', 'moved'],
      ['c2', 'moved'],
    ])
  })

  test('is outdated once the block reads differently', () => {
    const draft = buildDraft(
      plan(),
      [],
      entries({ kind: 'move', id: 'b3', to: { after: 'b5' }, was: 'The slow brown fox.' }),
    )
    expect(Object.values(draft.problems)).toEqual(['that block has changed since; undo this, and edit it again'])
  })
})

describe("moving some of a block's text in the draft", () => {
  test('takes the words and their comments to another block', () => {
    const idea = plan()
    const draft = buildDraft(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'quick') }],
      entries({
        kind: 'move-text',
        from: 'b3',
        old: ' quick',
        to: { in: 'b5', after: 'It might' },
        was: { from: 'The quick brown fox.', to: 'It might rain.' },
      }),
    )
    expect(draft.problems).toEqual({})
    expect(sourceOf(draft)).toContain('The brown fox.\n\n## Risks\n\nIt might quick rain.')
    expect(draft.comments[0]).toMatchObject({ id: 'c1', state: 'moved' })
  })

  test('is outdated once either block reads differently', () => {
    const draft = buildDraft(
      plan(),
      [],
      entries({
        kind: 'move-text',
        from: 'b3',
        old: ' quick',
        to: { in: 'b5', after: 'It might' },
        was: { from: 'The quick brown fox.', to: 'It may rain.' },
      }),
    )
    expect(Object.values(draft.problems)).toHaveLength(1)
  })
})
