// Golden tests for re-anchoring an uploaded copy: comments and IDs followed
// through a diff, by exact rules only.
import { describe, expect, test } from 'bun:test'
import { type Comment, createIdea, type Idea, textAnchor } from './idea.ts'
import { applyUpload, type Upload, type UploadResult } from './upload.ts'

const DOC = `# Plan

The quick brown fox jumps over the lazy dog.

## Risks

It might rain on the day.

## Costs

Cheap enough.
`
// IDs: f1; s2 Plan, b3, s4 Risks, b5, s6 Costs, b7

const doc = () => createIdea([{ path: 'plan.md', source: DOC }])

function upload(idea: Idea, comments: Comment[], files: Upload['files'], deleted?: string[]) {
  const result: UploadResult = applyUpload(idea, comments, { files, ...(deleted ? { deleted } : {}) })
  if (!result.ok) {
    throw new Error(`expected the upload to apply: ${result.problems.join('; ')}`)
  }
  return result
}

const outcome = (r: ReturnType<typeof upload>, id: string) => {
  const c = r.comments.find((x) => x.id === id)!
  return {
    state: c.state,
    quote: c.anchor?.kind === 'text' ? c.anchor.quote : null,
    file: c.anchor && 'file' in c.anchor ? c.anchor.file : null,
  }
}
const ids = (r: ReturnType<typeof upload>, file = 'f1') => r.idea.files.find((f) => f.id === file)!.unitIds

describe('following positions through the diff', () => {
  test('an unchanged upload changes nothing', () => {
    const idea = doc()
    const r = upload(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'lazy dog') }],
      [{ file: 'f1', path: 'plan.md', content: DOC }],
    )
    expect(ids(r)).toEqual(idea.files[0]!.unitIds)
    expect(outcome(r, 'c1')).toEqual({ state: 'exact', quote: 'lazy dog', file: 'f1' })
  })

  test('re-wrapping a paragraph or adding bold leaves comments exact', () => {
    const idea = doc()
    const content = DOC.replace(
      'The quick brown fox jumps over the lazy dog.',
      'The quick **brown** fox\njumps over the lazy dog.',
    )
    const r = upload(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'brown fox jumps') }],
      [{ file: 'f1', path: 'plan.md', content }],
    )
    expect(outcome(r, 'c1')).toEqual({ state: 'exact', quote: 'brown fox jumps', file: 'f1' })
    expect(ids(r)).toEqual(idea.files[0]!.unitIds)
  })

  test('duplicated text: each copy keeps its own comment', () => {
    const source = '# One\n\nShip it.\n\n# Two\n\nShip it.\n'
    const idea = createIdea([{ path: 'a.md', source }])
    const r = upload(
      idea,
      [{ id: 'second', anchor: textAnchor(idea, 'f1', 'Ship it.', 2) }],
      [{ file: 'f1', path: 'a.md', content: source.replace('Ship it.', 'Ship it today.') }],
    )
    expect(r.comments[0]).toEqual({
      id: 'second',
      state: 'exact',
      anchor: { kind: 'text', file: 'f1', start: 23, end: 31, quote: 'Ship it.' },
    })
  })

  test('a partly edited sentence keeps the part that survived, marked changed', () => {
    const idea = doc()
    const content = DOC.replace('jumps over the lazy dog', 'jumps over the sleeping cat')
    const r = upload(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'fox jumps over the lazy') }],
      [{ file: 'f1', path: 'plan.md', content }],
    )
    expect(outcome(r, 'c1')).toEqual({ state: 'changed', quote: 'fox jumps over the', file: 'f1' })
  })

  test("a rewritten sentence's comment becomes outdated", () => {
    const idea = doc()
    const content = DOC.replace('It might rain on the day.', 'Storms are likely in spring.')
    const r = upload(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'It might rain on the day.') }],
      [{ file: 'f1', path: 'plan.md', content }],
    )
    expect(outcome(r, 'c1').state).toBe('outdated')
    // the paragraph is still followed through the diff, so it keeps its ID
    expect(ids(r)).toEqual(idea.files[0]!.unitIds)
  })
})

describe('words rewritten', () => {
  test('a comment on words rewritten whole is outdated, not left on a letter they share', () => {
    // "three" and "two" share their "t": the diff may keep it, and a comment with only it left
    // would narrow to it. Rewritten in an upload, as "handbook" to "guide" is, it's outdated
    const source =
      '# Plan\n\nThe team writes it in three passes over a month.\n\nEach pass ends with a review.\n\n## Later\n\nNothing here yet.\n'
    const idea = createIdea([{ path: 'plan.md', source }])
    const content = source
      .replace('three passes over a month', 'two weeks')
      .replace('\n\nEach pass ends with a review.\n', '\n')
      .replace('Nothing here yet.', 'Nothing here yet.\n\nEach pass ends with a review.')
    const r = upload(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'three passes over a month') }],
      [{ file: 'f1', path: 'plan.md', content }],
    )
    expect(outcome(r, 'c1')).toEqual({ state: 'outdated', quote: null, file: null })
  })
})

describe('blocks that moved unchanged', () => {
  // A diff keeps the longest text in place, so in these cases the moved block is the short one.
  test('within a file: the block keeps its ID and comments, marked moved', () => {
    const idea = doc()
    const content = `# Plan

Cheap enough.

The quick brown fox jumps over the lazy dog.

## Risks

It might rain on the day.

## Costs
`
    const r = upload(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'Cheap enough') }],
      [{ file: 'f1', path: 'plan.md', content }],
    )
    expect(outcome(r, 'c1')).toEqual({ state: 'moved', quote: 'Cheap enough', file: 'f1' })
    expect(ids(r)).toEqual(['s2', 'b7', 'b3', 's4', 'b5', 's6'])
  })

  test('after a paragraph rewritten at its end: both end in a full stop, and every block is followed', () => {
    // the diff could keep either full stop; keeping the moved block's would leave a character of it
    // in place, and it wouldn't count as moved
    const source =
      '# Plan\n\nThe team writes it in three passes over a month.\n\nEach pass ends with a review by the whole team.\n\n## Steps\n\n- Draft it.\n- Argue.\n\n## Later\n\nNothing here yet.\n'
    // IDs: f1; s2 Plan, b3, b4 Each pass, s5 Steps, b6, b7, s8 Later, b9
    const idea = createIdea([{ path: 'plan.md', source }])
    const content = source
      .replace('three passes over a month', 'two passes')
      .replace('\n\nEach pass ends with a review by the whole team.\n', '\n')
      .replace('Nothing here yet.', 'Nothing here yet.\n\nEach pass ends with a review by the whole team.')
    const r = upload(
      idea,
      [
        { id: 'c1', anchor: { kind: 'block', file: 'f1', block: 'b4' } },
        { id: 'c2', anchor: textAnchor(idea, 'f1', 'the whole team') },
      ],
      [{ file: 'f1', path: 'plan.md', content }],
    )
    // the diff keeps the longer text in place, so Steps and Later are what moved, past it: each
    // section and block keeps its ID, and the comments stay on the block
    expect(ids(r)).toEqual(['s2', 'b3', 's5', 'b6', 'b7', 's8', 'b9', 'b4'])
    expect(outcome(r, 'c1')).toEqual({ state: 'exact', quote: null, file: 'f1' })
    expect(outcome(r, 'c2')).toEqual({ state: 'exact', quote: 'the whole team', file: 'f1' })
  })

  test('a section moved past a paragraph rewritten at its end keeps its ID, heading and body', () => {
    const source =
      '# Plan\n\nIt takes three passes over a month.\n\nEach pass ends with a review.\n\n## Later\n\nNothing yet.\n'
    // IDs: f1; s2 Plan, b3, b4, s5 Later, b6
    const idea = createIdea([{ path: 'plan.md', source }])
    const content = '# Plan\n\nIt takes two passes.\n\n## Later\n\nNothing yet.\n\nEach pass ends with a review.\n'
    const r = upload(
      idea,
      [{ id: 'c1', anchor: { kind: 'section', file: 'f1', section: 's5' } }],
      [{ file: 'f1', path: 'plan.md', content }],
    )
    expect(ids(r)).toEqual(['s2', 'b3', 's5', 'b6', 'b4'])
    expect(outcome(r, 'c1')).toEqual({ state: 'moved', quote: null, file: 'f1' })
  })

  test('into another file of the idea', () => {
    const idea = createIdea([
      { path: 'a.md', source: '# A\n\nKeep this.\n\nMove this paragraph.\n' },
      { path: 'b.md', source: '# B\n\nOther text.\n' },
    ])
    const r = upload(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'this paragraph') }],
      [
        { file: 'f1', path: 'a.md', content: '# A\n\nKeep this.\n' },
        { file: 'f5', path: 'b.md', content: '# B\n\nOther text.\n\nMove this paragraph.\n' },
      ],
    )
    expect(outcome(r, 'c1')).toEqual({ state: 'moved', quote: 'this paragraph', file: 'f5' })
    expect(ids(r, 'f5')).toEqual(['s6', 'b7', 'b4'])
  })

  test('a block that now appears twice is ambiguous, so its comment is outdated', () => {
    const stays = 'A long paragraph that stays where it is, so the diff keeps it in place.'
    const idea = createIdea([{ path: 'a.md', source: `# A\n\nRepeat me.\n\n# B\n\n${stays}\n` }])
    const r = upload(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'Repeat me') }],
      [{ file: 'f1', path: 'a.md', content: `# A\n\n# B\n\n${stays}\n\nRepeat me.\n\nRepeat me.\n` }],
    )
    expect(outcome(r, 'c1').state).toBe('outdated')
  })

  test('a section moved unchanged keeps its section comments; moved and edited, they become outdated', () => {
    const intro = 'An introduction long enough that the diff keeps it in place.'
    const costs = 'A paragraph about costs, also long enough to stay where it is.'
    const idea = createIdea([
      { path: 'a.md', source: `# Plan\n\n${intro}\n\n## Risks\n\nRain.\n\n## Costs\n\n${costs}\n` },
    ])
    const comments: Comment[] = [
      { id: 'section', anchor: { kind: 'section', file: 'f1', section: 's4' } },
      { id: 'text', anchor: textAnchor(idea, 'f1', 'Rain') },
    ]
    const moved = upload(idea, comments, [
      { file: 'f1', path: 'a.md', content: `# Plan\n\n${intro}\n\n## Costs\n\n${costs}\n\n## Risks\n\nRain.\n` },
    ])
    expect(outcome(moved, 'section').state).toBe('moved')
    expect(outcome(moved, 'text')).toEqual({ state: 'moved', quote: 'Rain', file: 'f1' })
    const movedAndEdited = upload(idea, comments, [
      { file: 'f1', path: 'a.md', content: `# Plan\n\n${intro}\n\n## Costs\n\n${costs}\n\n## Risks\n\nSnow.\n` },
    ])
    expect(outcome(movedAndEdited, 'section').state).toBe('outdated')
    expect(outcome(movedAndEdited, 'text').state).toBe('outdated')
  })
})

describe('headings renamed in place', () => {
  test('same place, same level, unchanged body: the same section', () => {
    const idea = doc()
    const r = upload(
      idea,
      [{ id: 'section', anchor: { kind: 'section', file: 'f1', section: 's4' } }],
      [{ file: 'f1', path: 'plan.md', content: DOC.replace('## Risks', '## Hazards') }],
    )
    expect(outcome(r, 'section')).toEqual({ state: 'exact', quote: null, file: 'f1' })
    expect(ids(r)).toEqual(idea.files[0]!.unitIds)
  })

  test('renamed with its body edited in the same upload: section comments become outdated', () => {
    const idea = doc()
    const content = DOC.replace('## Risks', '## Hazards').replace(
      'It might rain on the day.',
      'Storms are likely in spring.',
    )
    const r = upload(
      idea,
      [{ id: 'section', anchor: { kind: 'section', file: 'f1', section: 's4' } }],
      [{ file: 'f1', path: 'plan.md', content }],
    )
    expect(outcome(r, 'section').state).toBe('outdated')
    expect(ids(r)[2]).not.toBe('s4')
  })
})

describe('files', () => {
  test('new files, renames and deletions', () => {
    const idea = createIdea([
      { path: 'a.md', source: '# A\n' },
      { path: 'b.md', source: '# B\n' },
    ])
    const r = upload(
      idea,
      [
        { id: 'renamed', anchor: { kind: 'file', file: 'f1' } },
        { id: 'deleted', anchor: { kind: 'file', file: 'f3' } },
        { id: 'on-idea', anchor: { kind: 'idea' } },
      ],
      [
        { file: 'f1', path: 'docs/a.md', content: '# A\n' },
        { path: 'c.md', content: '# C\n' },
      ],
      ['f3'],
    )
    expect(r.idea.files.map((f) => [f.id, f.path])).toEqual([
      ['f1', 'docs/a.md'],
      ['f5', 'c.md'],
    ])
    expect(outcome(r, 'renamed').state).toBe('exact')
    expect(outcome(r, 'deleted').state).toBe('outdated')
    expect(r.comments.find((c) => c.id === 'on-idea')).toEqual({
      id: 'on-idea',
      state: 'exact',
      anchor: { kind: 'idea' },
    })
  })

  test('problems are reported, and nothing applies', () => {
    const idea = createIdea([
      { path: 'a.md', source: '# A\n' },
      { path: 'b.md', source: '# B\n' },
    ])
    const r = applyUpload(idea, [], {
      files: [
        { file: 'f9', path: 'x.md', content: '' },
        { path: 'B.md', content: '' },
        { path: 'notes.txt', content: '' },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.problems).toContain("f9 isn't in this version")
      expect(r.problems).toContain('b.md is used by more than one file')
      expect(r.problems.some((p) => p.startsWith('notes.txt'))).toBe(true)
    }
  })
})

describe('comments on a block', () => {
  test('a block moved unchanged keeps its comment, marked moved; edited in place, it keeps it; deleted, it is outdated', () => {
    const idea = doc()
    const block: Comment = { id: 'c1', anchor: { kind: 'block', file: 'f1', block: 'b7' } }
    const moved = upload(
      idea,
      [block],
      [
        {
          file: 'f1',
          path: 'plan.md',
          content: `# Plan

Cheap enough.

The quick brown fox jumps over the lazy dog.

## Risks

It might rain on the day.

## Costs
`,
        },
      ],
    )
    expect(outcome(moved, 'c1')).toEqual({ state: 'moved', quote: null, file: 'f1' })
    // the same block, its words changed: the comment is on the block, not its words
    const edited = upload(
      idea,
      [block],
      [{ file: 'f1', path: 'plan.md', content: DOC.replace('Cheap enough.', 'Costly, it turns out.') }],
    )
    expect(outcome(edited, 'c1')).toEqual({ state: 'exact', quote: null, file: 'f1' })
    const deleted = upload(
      idea,
      [block],
      [{ file: 'f1', path: 'plan.md', content: DOC.replace('\nCheap enough.\n', '') }],
    )
    expect(outcome(deleted, 'c1').state).toBe('outdated')
  })
})
