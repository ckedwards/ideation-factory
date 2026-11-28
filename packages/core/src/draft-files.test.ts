// Files made, renamed and deleted in the draft (docs: Files in the browser), and the link fixes a
// rename or move needs: built in order like any change, committed as one version.
import { describe, expect, test } from 'bun:test'
import { applyBatch } from './apply.ts'
import { buildDraft, type DraftChange, type DraftEntry } from './draft.ts'
import { createIdea, type Idea, textAnchor } from './idea.ts'
import { folderRenames, linkFixes, renameChanges, renameFixCommands } from './links.ts'

// f1 index.md: s2 Index, b3; f4 sync-states.md: s5 States, b6; f7 research/interviews.md: b8;
// f9 research/notes.md: b10; next ID 11
const idea = () =>
  createIdea([
    {
      path: 'index.md',
      source: '# Index\n\nSee [states](sync-states.md) and [the interviews](research/interviews.md).\n',
    },
    { path: 'sync-states.md', source: '# States\n\nOffline, then syncing.\n' },
    { path: 'research/interviews.md', source: 'Five people. See [notes](notes.md#costs) and [index](../index.md).\n' },
    { path: 'research/notes.md', source: 'Notes, after [the interviews](./interviews.md).\n' },
  ])
let n = 0
const entries = (...changes: DraftChange[]): DraftEntry[] => changes.map((change) => ({ key: `k${++n}`, change }))
const source = (built: { idea: Idea }, path: string) => built.idea.files.find((f) => f.path === path)?.source

/** Commits a draft's batch on the version it was built on: the same idea, or why not. */
function committed(base: Idea, draft: ReturnType<typeof buildDraft>) {
  const done = applyBatch(base, [], { base: 1, steps: draft.commands })
  if (!done.ok) {
    throw new Error(done.conflicts.map((c) => c.message).join('; '))
  }
  return done.idea
}

describe('a file made in the draft', () => {
  test('takes the ID committing gives it, and later changes name it and its blocks', () => {
    const base = idea()
    const [made, typed] = entries(
      { kind: 'create-file', path: 'research/costs.md', markdown: '' },
      { kind: 'insert', at: { start: 'f11' }, markdown: 'About a pound a month.' },
    )
    const draft = buildDraft(base, [], [made!, typed!])
    expect(draft.problems).toEqual({})
    const file = draft.files.find((f) => f.path === 'research/costs.md')!
    expect(file).toMatchObject({ id: 'f11', made: made!.key, was: null, source: 'About a pound a month.\n' })
    expect(file.units[0]!.origin).toEqual({ kind: 'new', change: typed!.key })
    expect(committed(base, draft)).toEqual(draft.idea)
  })

  test('is refused on a path another file has, in any case', () => {
    const draft = buildDraft(idea(), [], entries({ kind: 'create-file', path: 'Sync-States.md', markdown: '' }))
    expect(Object.values(draft.problems)[0]).toContain('already used by f4')
    expect(draft.files).toHaveLength(4)
  })
})

describe('a file renamed in the draft', () => {
  test('keeps its ID, so comments on it and in it stay where they are', () => {
    const base = idea()
    const comments = [
      { id: 'c1', anchor: { kind: 'file' as const, file: 'f4' } },
      { id: 'c2', anchor: textAnchor(base, 'f4', 'then syncing') },
    ]
    const draft = buildDraft(
      base,
      comments,
      entries({ kind: 'rename-file', file: 'f4', path: 'states.md', was: 'sync-states.md' }),
    )
    expect(draft.files.find((f) => f.id === 'f4')).toMatchObject({ path: 'states.md', was: 'sync-states.md' })
    expect(draft.comments.map((c) => c.state)).toEqual(['exact', 'exact'])
  })

  test('is outdated if someone renamed it since', () => {
    const base = idea()
    const [theirs, mine] = entries(
      { kind: 'rename-file', file: 'f4', path: 'states.md', was: 'sync-states.md' },
      { kind: 'rename-file', file: 'f4', path: 'sync.md', was: 'sync-states.md' },
    )
    const draft = buildDraft(base, [], [theirs!, mine!])
    expect(draft.problems[mine!.key]).toContain('renamed to states.md since')
    expect(draft.files.find((f) => f.id === 'f4')!.path).toBe('states.md')
  })
})

describe('a file deleted in the draft', () => {
  test('outdates the comments on it, and is kept as it was so it can be restored', () => {
    const base = idea()
    const comments = [{ id: 'c1', anchor: textAnchor(base, 'f4', 'then syncing') }]
    const [typed, gone] = entries(
      { kind: 'edit', id: 'b6', source: 'Offline, then syncing, then done.', was: 'Offline, then syncing.' },
      { kind: 'delete-file', file: 'f4' },
    )
    const draft = buildDraft(base, comments, [typed!, gone!])
    expect(draft.files.map((f) => f.id)).toEqual(['f1', 'f7', 'f9'])
    // what was typed in it before it was deleted is still there
    expect(draft.deleted).toEqual([
      {
        id: 'f4',
        path: 'sync-states.md',
        source: '# States\n\nOffline, then syncing, then done.\n',
        change: gone!.key,
        made: null,
      },
    ])
    expect(draft.comments[0]).toEqual({ id: 'c1', state: 'outdated', anchor: null })
  })

  test('with an edit before it, commits as the delete alone', () => {
    const base = idea()
    const deletedOnly = buildDraft(base, [], entries({ kind: 'delete-file', file: 'f4' }))
    const editedToo = buildDraft(
      base,
      [],
      entries(
        { kind: 'edit', id: 'b6', source: 'Offline.', was: 'Offline, then syncing.' },
        { kind: 'delete-file', file: 'f4' },
      ),
    )
    expect(committed(base, editedToo)).toEqual(committed(base, deletedOnly))
  })

  test('made in the same draft, keeps what was typed in it, and says it was new', () => {
    const [made, gone] = entries(
      { kind: 'create-file', path: 'scratch.md', markdown: 'A thought.' },
      { kind: 'delete-file', file: 'f11' },
    )
    const draft = buildDraft(idea(), [], [made!, gone!])
    expect(draft.deleted).toEqual([
      { id: 'f11', path: 'scratch.md', source: 'A thought.\n', change: gone!.key, made: made!.key },
    ])
  })

  test('can’t be the last one', () => {
    const single = createIdea([{ path: 'plan.md', source: 'Plan.\n' }])
    const [gone] = entries({ kind: 'delete-file', file: 'f1' })
    const draft = buildDraft(single, [], [gone!])
    expect(draft.problems[gone!.key]).toContain('at least one file')
    expect(draft.deleted).toEqual([])
  })
})

describe('renaming fixes links', () => {
  test('to the renamed file, in the idea’s other files', () => {
    const base = idea()
    const renamed = renameChanges(base, [{ file: 'f4', path: 'states.md' }])
    expect(renamed).toMatchObject({ ok: true, links: 1 })
    const draft = buildDraft(base, [], entries(...(renamed.ok ? renamed.changes : [])))
    expect(draft.problems).toEqual({})
    expect(source(draft, 'index.md')).toBe(
      '# Index\n\nSee [states](states.md) and [the interviews](research/interviews.md).\n',
    )
  })

  test('in a file moved to another folder, its own links still lead where they did', () => {
    const base = idea()
    const renamed = renameChanges(base, [{ file: 'f9', path: 'notes.md' }])
    const draft = buildDraft(base, [], entries(...(renamed.ok ? renamed.changes : [])))
    expect(source(draft, 'notes.md')).toBe('Notes, after [the interviews](research/interviews.md).\n')
    // and the link to it, from beside where it was, follows it
    expect(source(draft, 'research/interviews.md')).toBe(
      'Five people. See [notes](../notes.md#costs) and [index](../index.md).\n',
    )
  })

  test('a folder renamed moves every file in it, and leaves the links between them alone', () => {
    const base = idea()
    const renamed = renameChanges(base, folderRenames(base, 'research', 'findings'))
    expect(renamed).toMatchObject({ ok: true, links: 1 })
    const draft = buildDraft(base, [], entries(...(renamed.ok ? renamed.changes : [])))
    expect(draft.files.map((f) => f.path)).toEqual([
      'index.md',
      'sync-states.md',
      'findings/interviews.md',
      'findings/notes.md',
    ])
    expect(source(draft, 'index.md')).toContain('[the interviews](findings/interviews.md)')
    expect(source(draft, 'findings/interviews.md')).toContain('[notes](notes.md#costs) and [index](../index.md)')
    expect(source(draft, 'findings/notes.md')).toContain('[the interviews](./interviews.md)')
  })

  test('comments on a block whose link is fixed stay on it', () => {
    const base = idea()
    const comments = [{ id: 'c1', anchor: textAnchor(base, 'f1', 'See states') }]
    const renamed = renameChanges(base, [{ file: 'f4', path: 'states.md' }])
    const draft = buildDraft(base, comments, entries(...(renamed.ok ? renamed.changes : [])))
    expect(draft.comments[0]).toMatchObject({ state: 'exact', anchor: { quote: 'See states' } })
  })

  test('a rename to a path another file has, or will have, is refused', () => {
    const base = idea()
    expect(renameChanges(base, [{ file: 'f4', path: 'INDEX.md' }])).toEqual({
      ok: false,
      message: 'There’s already a file called INDEX.md',
    })
    expect(
      renameChanges(base, [
        { file: 'f4', path: 'a.md' },
        { file: 'f1', path: 'a.md' },
      ]),
    ).toMatchObject({ ok: false })
    expect(renameChanges(base, [{ file: 'f4', path: 'states.txt' }])).toMatchObject({ ok: false })
  })

  test('a chain of renames goes in an order that works; a swap is refused', () => {
    const base = createIdea([
      { path: 'a.md', source: 'A.\n' },
      { path: 'b.md', source: 'B.\n' },
    ])
    // a.md → b.md, b.md → c.md, c.md → d.md: each moves out before the next moves in
    const three = createIdea([
      { path: 'a.md', source: 'A.\n' },
      { path: 'b.md', source: 'B.\n' },
      { path: 'c.md', source: 'C.\n' },
    ])
    const chain = renameChanges(three, [
      { file: 'f1', path: 'b.md' },
      { file: 'f3', path: 'c.md' },
      { file: 'f5', path: 'd.md' },
    ])
    const draft = buildDraft(three, [], entries(...(chain.ok ? chain.changes : [])))
    expect(draft.problems).toEqual({})
    expect(draft.files.map((f) => f.path)).toEqual(['b.md', 'c.md', 'd.md'])
    // a.md ↔ b.md: each takes a path the other still has
    expect(
      renameChanges(base, [
        { file: 'f1', path: 'b.md' },
        { file: 'f3', path: 'a.md' },
      ]),
    ).toMatchObject({ ok: false, message: expect.stringContaining('rename one of them to a free name first') })
  })
})

describe('the links a fix rewrites', () => {
  const fixes = (source: string, from: string, to: string, others: Array<{ path: string; source: string }> = []) => {
    const base = createIdea([{ path: from, source }, ...others])
    return linkFixes(base, [{ file: 'f1', path: to }]).map((f) => f.source)
  }

  test('images and link definitions too; a heading or query after the path stays', () => {
    expect(fixes('![chart](images/a.png "A chart")\n\n[ref]: ../out.md?x=1#top\n', 'plan.md', 'docs/plan.md')).toEqual([
      '![chart](../images/a.png "A chart")',
      '[ref]: ../../out.md?x=1#top',
    ])
  })

  test('not addresses with a scheme, from the root, or to a heading of the file itself', () => {
    expect(
      fixes(
        '[a](https://example.com/a.md) [b](/b.md) [c](#costs) [d](mailto:x@example.com)\n',
        'plan.md',
        'docs/plan.md',
      ),
    ).toEqual([])
  })

  test('spaces in a path stay readable: escaped, or in angle brackets as written', () => {
    expect(fixes('[a](my%20notes.md) [b](<my notes.md>)\n', 'plan.md', 'docs/plan.md')).toEqual([
      '[a](../my%20notes.md) [b](<../my notes.md>)',
    ])
  })

  test('a link inside a list item or a table is fixed in its own block', () => {
    expect(fixes('- [a](a.md)\n\n| x |\n| - |\n| [b](b.md) |\n', 'plan.md', 'docs/plan.md')).toEqual([
      '- [a](../a.md)',
      '| x |\n| - |\n| [b](../b.md) |',
    ])
  })

  test('a reference link isn’t touched: its definition is', () => {
    expect(fixes('See [notes][n].\n\n[n]: notes.md\n', 'plan.md', 'docs/plan.md')).toEqual(['[n]: ../notes.md'])
  })
})

describe('a file the server gave an ID', () => {
  test('keeps it when committed, and the next IDs come after it', () => {
    const base = idea()
    const [made, typed] = entries(
      { kind: 'create-file', path: 'costs.md', markdown: '', file: 'f20' },
      { kind: 'insert', at: { start: 'f20' }, markdown: 'A pound a month.' },
    )
    const draft = buildDraft(base, [], [made!, typed!])
    expect(draft.problems).toEqual({})
    expect(draft.files.find((f) => f.path === 'costs.md')).toMatchObject({ id: 'f20', unitIds: ['b21'] })
    expect(draft.idea.nextId).toBe(22)
  })

  test('is refused if the ID is already used', () => {
    const draft = buildDraft(idea(), [], entries({ kind: 'create-file', path: 'costs.md', markdown: '', file: 'f4' }))
    expect(Object.values(draft.problems)[0]).toContain('f4 is already used')
  })
})

describe('the fixes a batch’s renames need', () => {
  test('go after its steps, and leave a block the batch changes, or a file it deletes, as it has them', () => {
    const base = idea()
    const rename = [{ command: 'rename-file' as const, file: 'f4', path: 'states.md' }]
    const done = applyBatch(base, [], { base: 1, steps: [...rename, ...renameFixCommands(base, rename)] })
    expect(done.ok && done.idea.files[0]!.source).toContain('See [states](states.md) and')
    expect(
      renameFixCommands(base, [
        { command: 'rename-file', file: 'f4', path: 'states.md' },
        { command: 'replace', in: 'b3', old: 'See', new: 'Read' },
      ]),
    ).toEqual([])
    expect(
      renameFixCommands(base, [
        { command: 'rename-file', file: 'f7', path: 'interviews.md' },
        { command: 'delete-file', file: 'f9' },
      ]).length,
    ).toBe(2)
  })
})
