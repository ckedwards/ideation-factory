// An idea's draft: changes built in order on the latest version, each checked
// against the draft as it is at that point.
import { describe, expect, test } from 'bun:test'
import { applyBatch } from './apply.ts'
import { addChange, buildDraft, type DraftChange, type DraftEntry, unitSource } from './draft.ts'
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

describe('the draft keeps the difference, not the history', () => {
  const edit = (source: string, was: string, id = 'b3'): DraftChange => ({ kind: 'edit', id, source, was })
  /** Adds each change in turn, as the server would, keeping what the draft keeps. */
  function typed(...made: Array<[DraftChange, string]>) {
    let list: Array<DraftEntry & { by: string }> = []
    for (const [change, by] of made) {
      const { addition, problem } = addChange(plan(), [], list, change, by, `k${++n}`)
      expect(problem).toBeNull()
      list =
        addition.op === 'add'
          ? [...list, { ...addition.entry, by }]
          : addition.op === 'update'
            ? list.map((e) => (e.key === addition.entry.key ? { ...e, change: addition.entry.change } : e))
            : list.filter((e) => e.key !== addition.key)
    }
    return list
  }

  test('your edits to a block, one after another, are one change', () => {
    const list = typed(
      [edit('The quick red fox.', 'The quick brown fox.'), 'riley'],
      [edit('The slow red fox.', 'The quick red fox.'), 'riley'],
      [edit('The slow red fox!', 'The slow red fox.'), 'riley'],
    )
    expect(list.map((e) => e.change)).toEqual([edit('The slow red fox!', 'The quick brown fox.')])
  })

  test("even with someone else's change to another block between them", () => {
    const list = typed(
      [edit('The quick red fox.', 'The quick brown fox.'), 'riley'],
      [edit('It may rain.', 'It might rain.', 'b5'), 'sam'],
      [edit('The slow red fox.', 'The quick red fox.'), 'riley'],
    )
    expect(list.map((e) => [e.by, e.change])).toEqual([
      ['riley', edit('The slow red fox.', 'The quick brown fox.')],
      ['sam', edit('It may rain.', 'It might rain.', 'b5')],
    ])
  })

  test("someone else's edit of your edited block is a change of its own", () => {
    const list = typed(
      [edit('The quick red fox.', 'The quick brown fox.'), 'riley'],
      [edit('The slow red fox.', 'The quick red fox.'), 'sam'],
    )
    expect(list.map((e) => e.by)).toEqual(['riley', 'sam'])
  })

  test('a block typed back to how it was leaves no change', () => {
    const list = typed(
      [edit('The quick red fox.', 'The quick brown fox.'), 'riley'],
      [edit('The quick brown fox.', 'The quick red fox.'), 'riley'],
    )
    expect(list).toEqual([])
  })

  test('editing text you added changes the addition; editing it away takes it out', () => {
    const added = typed([{ kind: 'insert', at: { after: 'b3' }, markdown: 'New text.' }, 'riley'])
    // the new block is b8, as committing would make it
    const edited = typed(
      [{ kind: 'insert', at: { after: 'b3' }, markdown: 'New text.' }, 'riley'],
      [edit('Newer text.', 'New text.', 'b8'), 'riley'],
    )
    expect(added).toHaveLength(1)
    expect(edited.map((e) => e.change)).toEqual([{ kind: 'insert', at: { after: 'b3' }, markdown: 'Newer text.' }])
    expect(
      typed(
        [{ kind: 'insert', at: { after: 'b3' }, markdown: 'New text.' }, 'riley'],
        [edit('', 'New text.', 'b8'), 'riley'],
      ),
    ).toEqual([])
  })

  test('a fold that would make a later change outdated is a change of its own instead', () => {
    // riley edits b3, sam moves b3's words elsewhere (made against riley's edit), then riley edits
    // b3 again: folding back past sam's move would leave the move's text missing
    const list = typed(
      [edit('The quick red fox.', 'The quick brown fox.'), 'riley'],
      [
        {
          kind: 'move-text',
          from: 'b3',
          old: ' red',
          to: { in: 'b5', after: 'It might' },
          was: { from: 'The quick red fox.', to: 'It might rain.' },
        },
        'sam',
      ],
      [edit('The slow fox.', 'The quick fox.'), 'riley'],
    )
    expect(list.map((e) => e.change.kind)).toEqual(['edit', 'move-text', 'edit'])
  })
})

describe('comments on text typed around', () => {
  const item = () =>
    createIdea([{ path: 'a.md', source: '# T\n\n- One.\n- A banner says the app is offline, and more.\n' }])
  const typed = (source: string) => {
    const idea = item()
    // s2 T, b3 One, b4 the banner item
    const comment = { id: 'c1', anchor: textAnchor(idea, 'f1', 'A banner says the app is offline') }
    const draft = buildDraft(
      idea,
      [comment],
      [{ key: 'k1', change: { kind: 'edit', id: 'b4', source, was: '- A banner says the app is offline, and more.' } }],
    )
    return draft.comments[0]!
  }

  test('words typed just before a comment leave it on all of its words', () => {
    for (const before of ['New: ', 'New ', 'X']) {
      expect(typed(`- ${before}A banner says the app is offline, and more.`)).toMatchObject({
        state: 'exact',
        anchor: { quote: 'A banner says the app is offline' },
      })
    }
  })

  test('words typed just after one leave it as it was', () => {
    expect(typed('- A banner says the app is offline now, and more.')).toMatchObject({
      state: 'exact',
      anchor: { quote: 'A banner says the app is offline' },
    })
  })

  test('words typed into one change it', () => {
    expect(typed('- A red banner says the app is offline, and more.')).toMatchObject({
      state: 'changed',
      anchor: { quote: 'A red banner says the app is offline' },
    })
  })

  test('a suggestion that only adds words gives its comment all of its new text', () => {
    const idea = plan()
    const comment = { id: 'c1', anchor: textAnchor(idea, 'f1', 'might rain') }
    const draft = buildDraft(
      idea,
      [comment],
      entries({ kind: 'suggestion', comment: 'c1', old: 'might rain', new: 'might rain hard' }),
    )
    expect(draft.comments).toEqual([
      { id: 'c1', state: 'changed', anchor: expect.objectContaining({ quote: 'might rain hard' }) },
    ])
  })
})
