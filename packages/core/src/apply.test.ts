// Golden tests for editing with commands: what each command does to the files,
// the IDs and the comments.
import { describe, expect, test } from 'bun:test'
import { applyBatch, type BatchResult } from './apply.ts'
import type { Command } from './batch.ts'
import { type Comment, createIdea, type Idea, textAnchor } from './idea.ts'
import { parseMarkdown } from './markdown.ts'

const PLAN = `# Plan

The quick brown fox jumps over the lazy dog.

## Risks

It might rain on the day.

- Weather
- Budget

## Costs

Cheap enough.
`
// IDs: f1 the file; s2 Plan, b3 its paragraph, s4 Risks, b5 its paragraph,
// b6 Weather, b7 Budget, s8 Costs, b9 its paragraph

const plan = () => createIdea([{ path: 'plan.md', source: PLAN }])

function run(idea: Idea, comments: Comment[], ...steps: Command[]): BatchResult {
  return applyBatch(idea, comments, { base: 1, steps })
}

function ok(result: BatchResult) {
  if (!result.ok) {
    throw new Error(`expected the batch to apply: ${JSON.stringify(result.conflicts)}`)
  }
  return result
}

const source = (result: BatchResult, file = 'f1') => ok(result).idea.files.find((f) => f.id === file)!.source
const ids = (result: BatchResult, file = 'f1') => ok(result).idea.files.find((f) => f.id === file)!.unitIds
const outcome = (result: BatchResult, id: string) => {
  const c = ok(result).comments.find((x) => x.id === id)!
  return {
    state: c.state,
    quote: c.anchor?.kind === 'text' ? c.anchor.quote : null,
    file: c.anchor && 'file' in c.anchor ? c.anchor.file : null,
  }
}

test('the fixture has the IDs the tests rely on', () => {
  expect(plan().files[0]!.unitIds).toEqual(['s2', 'b3', 's4', 'b5', 'b6', 'b7', 's8', 'b9'])
})

describe('replace', () => {
  test('a comment on the replaced text covers the new text, marked changed; others are exact', () => {
    const idea = plan()
    const r = run(
      idea,
      [
        { id: 'c1', anchor: textAnchor(idea, 'f1', 'brown') },
        { id: 'c2', anchor: textAnchor(idea, 'f1', 'lazy dog') },
        { id: 'c3', anchor: textAnchor(idea, 'f1', 'might rain') },
      ],
      { command: 'replace', in: 'b3', old: 'brown', new: 'red' },
    )
    expect(source(r)).toBe(PLAN.replace('brown', 'red'))
    expect(ids(r)).toEqual(plan().files[0]!.unitIds)
    expect(outcome(r, 'c1')).toEqual({ state: 'changed', quote: 'red', file: 'f1' })
    expect(outcome(r, 'c2')).toEqual({ state: 'exact', quote: 'lazy dog', file: 'f1' })
    expect(outcome(r, 'c3')).toEqual({ state: 'exact', quote: 'might rain', file: 'f1' })
  })

  test('a comment that partly overlaps keeps the untouched part', () => {
    const idea = plan()
    const r = run(idea, [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'quick brown') }], {
      command: 'replace',
      in: 'b3',
      old: 'brown fox',
      new: 'red cat',
    })
    expect(outcome(r, 'c1')).toEqual({ state: 'changed', quote: 'quick', file: 'f1' })
  })

  test('a comment around the replaced text keeps covering it', () => {
    const idea = plan()
    const r = run(idea, [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'quick brown fox') }], {
      command: 'replace',
      in: 'b3',
      old: 'brown',
      new: 'red',
    })
    expect(outcome(r, 'c1')).toEqual({ state: 'changed', quote: 'quick red fox', file: 'f1' })
  })

  test('replacing a whole paragraph keeps its block ID', () => {
    const r = run(plan(), [], {
      command: 'replace',
      in: 'b5',
      old: 'It might rain on the day.',
      new: 'Rain is likely.',
    })
    expect(source(r)).toContain('## Risks\n\nRain is likely.\n\n- Weather')
    expect(ids(r)).toEqual(plan().files[0]!.unitIds)
  })

  test('`old` must match exactly once in its scope', () => {
    const idea = plan()
    const none = run(idea, [], { command: 'replace', in: 'b3', old: 'purple', new: 'x' })
    expect(none).toEqual({ ok: false, conflicts: [expect.objectContaining({ step: 0, reason: 'no_match' })] })
    const several = run(idea, [], { command: 'replace', in: 'f1', old: 'the', new: 'a' })
    expect(several).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({ reason: 'ambiguous', message: expect.stringContaining('3 times') })],
    })
    // the same text, scoped to one block, is fine
    expect(source(run(idea, [], { command: 'replace', in: 'b5', old: 'the', new: 'a' }))).toContain(
      'It might rain on a day.',
    )
  })

  test('duplicated text: each copy keeps its own comment', () => {
    const idea = createIdea([{ path: 'a.md', source: '# One\n\nShip it.\n\n# Two\n\nShip it.\n' }])
    const r = run(idea, [{ id: 'second', anchor: textAnchor(idea, 'f1', 'Ship it.', 2) }], {
      command: 'replace',
      in: 's2',
      old: 'Ship it.',
      new: 'Ship it now.',
    })
    expect(source(r)).toBe('# One\n\nShip it now.\n\n# Two\n\nShip it.\n')
    const c = ok(r).comments[0]!
    expect(c.state).toBe('exact')
    expect(c.anchor).toEqual({ kind: 'text', file: 'f1', start: 21, end: 29, quote: 'Ship it.' })
  })
})

describe('move', () => {
  test('a moved section keeps its IDs, and its comments move with it', () => {
    const idea = plan()
    const r = run(
      idea,
      [
        { id: 'text', anchor: textAnchor(idea, 'f1', 'might rain') },
        { id: 'section', anchor: { kind: 'section', file: 'f1', section: 's4' } },
        { id: 'stays', anchor: textAnchor(idea, 'f1', 'Cheap') },
      ],
      { command: 'move', target: 's4', to: { after: 's8' } },
    )
    expect(source(r)).toBe(`# Plan

The quick brown fox jumps over the lazy dog.

## Costs

Cheap enough.

## Risks

It might rain on the day.

- Weather
- Budget
`)
    expect(ids(r)).toEqual(['s2', 'b3', 's8', 'b9', 's4', 'b5', 'b6', 'b7'])
    expect(outcome(r, 'text')).toEqual({ state: 'moved', quote: 'might rain', file: 'f1' })
    expect(outcome(r, 'section').state).toBe('moved')
    expect(outcome(r, 'stays')).toEqual({ state: 'exact', quote: 'Cheap', file: 'f1' })
  })

  test('comments follow a move even when a later step edits the moved text', () => {
    const idea = plan()
    const r = run(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'might rain') }],
      { command: 'move', target: 's4', to: { before: 's2' } },
      { command: 'replace', in: 'b5', old: 'rain', new: 'snow' },
    )
    expect(source(r).startsWith('## Risks\n\nIt might snow on the day.\n\n- Weather\n- Budget\n\n# Plan\n')).toBe(true)
    // the comment partly overlapped the replaced word, so it keeps the untouched part
    expect(outcome(r, 'c1')).toEqual({ state: 'changed', quote: 'might', file: 'f1' })
  })

  test('a list item moves within its list', () => {
    const r = run(plan(), [], { command: 'move', target: 'b7', to: { before: 'b6' } })
    expect(source(r)).toContain('- Budget\n- Weather\n')
    expect(ids(r)).toEqual(['s2', 'b3', 's4', 'b5', 'b7', 'b6', 's8', 'b9'])
  })

  test('a block moves to a new file in the same batch, with its comment', () => {
    const idea = plan()
    const r = run(
      idea,
      [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'Cheap enough') }],
      { command: 'create-file', path: 'costs.md', markdown: '# Costs in detail' },
      { command: 'move', target: 'b9', to: { end: 'f10' } },
    )
    expect(source(r, 'f10')).toBe('# Costs in detail\n\nCheap enough.\n')
    expect(source(r)).toContain('## Costs\n')
    expect(source(r)).not.toContain('Cheap')
    expect(ids(r, 'f10')).toEqual(['s11', 'b9'])
    expect(outcome(r, 'c1')).toEqual({ state: 'moved', quote: 'Cheap enough', file: 'f10' })
  })

  test("a section can't be moved inside itself", () => {
    const r = run(plan(), [], { command: 'move', target: 's4', to: { after: 'b6' } })
    expect(r).toEqual({ ok: false, conflicts: [expect.objectContaining({ reason: 'invalid' })] })
  })
})

describe('delete', () => {
  test("a deleted block's comments become outdated", () => {
    const idea = plan()
    const r = run(
      idea,
      [
        { id: 'gone', anchor: textAnchor(idea, 'f1', 'might rain') },
        { id: 'kept', anchor: textAnchor(idea, 'f1', 'Weather') },
      ],
      { command: 'delete', target: 'b5' },
    )
    expect(source(r)).toContain('## Risks\n\n- Weather\n- Budget\n\n## Costs')
    expect(outcome(r, 'gone')).toEqual({ state: 'outdated', quote: null, file: null })
    expect(outcome(r, 'kept')).toEqual({ state: 'exact', quote: 'Weather', file: 'f1' })
  })

  test('deleting a section removes its subsections and outdates their comments', () => {
    const idea = plan()
    const r = run(
      idea,
      [
        { id: 'section', anchor: { kind: 'section', file: 'f1', section: 's4' } },
        { id: 'inside', anchor: textAnchor(idea, 'f1', 'Budget') },
      ],
      { command: 'delete', target: 's4' },
    )
    expect(source(r)).toBe('# Plan\n\nThe quick brown fox jumps over the lazy dog.\n\n## Costs\n\nCheap enough.\n')
    expect(outcome(r, 'section').state).toBe('outdated')
    expect(outcome(r, 'inside').state).toBe('outdated')
  })

  test('deleting the last block keeps the file ending tidy', () => {
    expect(source(run(plan(), [], { command: 'delete', target: 'b9' }))).toEndWith('- Budget\n\n## Costs\n')
  })
})

describe('the last item of a list', () => {
  test('deleted or moved, leaves the paragraph after the list a paragraph', () => {
    const idea = createIdea([{ path: 'a.md', source: 'Intro.\n\n- one\n- two\n- three\n\nText.\n' }])
    // b2 Intro, b3 b4 b5 the items, b6 Text
    const deleted = run(idea, [], { command: 'delete', target: 'b5' })
    expect(source(deleted)).toBe('Intro.\n\n- one\n- two\n\nText.\n')
    expect(ids(deleted)).toEqual(['b2', 'b3', 'b4', 'b6'])
    const moved = run(idea, [], { command: 'move', target: 'b5', to: { before: 'b3' } })
    expect(source(moved)).toBe('Intro.\n\n- three\n- one\n- two\n\nText.\n')
    expect(ids(moved)).toEqual(['b2', 'b5', 'b3', 'b4', 'b6'])
  })
})

describe('move-text', () => {
  test("moves some of a block's text into another block, with the comments on it; the blocks keep their IDs", () => {
    const idea = plan()
    const r = run(
      idea,
      [
        { id: 'moved', anchor: textAnchor(idea, 'f1', 'quick brown') },
        { id: 'stays', anchor: textAnchor(idea, 'f1', 'lazy dog') },
      ],
      { command: 'move-text', in: 'b3', old: ' quick brown', to: { in: 'b5', after: 'It might' } },
    )
    expect(source(r)).toContain('The fox jumps over the lazy dog.\n\n## Risks\n\nIt might quick brown rain on the day.')
    expect(ids(r)).toEqual(plan().files[0]!.unitIds)
    expect(outcome(r, 'moved')).toEqual({ state: 'moved', quote: 'quick brown', file: 'f1' })
    expect(outcome(r, 'stays')).toEqual({ state: 'exact', quote: 'lazy dog', file: 'f1' })
  })

  test('within one block, and into another file', () => {
    expect(
      source(run(plan(), [], { command: 'move-text', in: 'b3', old: 'quick ', to: { in: 'b3', before: 'dog' } })),
    ).toContain('The brown fox jumps over the lazy quick dog.')
    const two = createIdea([
      { path: 'plan.md', source: PLAN },
      { path: 'notes.md', source: 'Notes here.\n' },
    ])
    const r = ok(
      run(two, [{ id: 'c', anchor: textAnchor(two, 'f1', 'quick brown') }], {
        command: 'move-text',
        in: 'b3',
        old: ' quick brown',
        to: { in: two.files[1]!.unitIds[0]!, after: 'Notes' },
      }),
    )
    expect(r.idea.files[1]!.source).toBe('Notes quick brown here.\n')
    expect(r.comments[0]).toMatchObject({ state: 'moved', anchor: { file: two.files[1]!.id } })
  })

  test("refuses what it can't find once, a whole block, and more than a block", () => {
    const conflicts = (step: Command) => {
      const r = run(plan(), [], step)
      return r.ok ? [] : r.conflicts.map((c) => [c.reason, c.message])
    }
    expect(conflicts({ command: 'move-text', in: 'b3', old: 'cat', to: { in: 'b5', after: 'rain' } })).toEqual([
      ['no_match', '"cat" isn\'t in b3'],
    ])
    expect(conflicts({ command: 'move-text', in: 'b3', old: 'quick', to: { in: 'b3', after: 'o' } })[0]![0]).toBe(
      'ambiguous',
    )
    expect(
      conflicts({
        command: 'move-text',
        in: 'b3',
        old: 'The quick brown fox jumps over the lazy dog.',
        to: { in: 'b5', after: 'rain' },
      }),
    ).toEqual([['invalid', "that's all of b3: move the block with move"]])
    expect(conflicts({ command: 'move-text', in: 'b3', old: 'quick', to: { in: 'b3', after: 'qu' } })).toEqual([
      ['invalid', "can't move text into itself"],
    ])
  })
})

describe('rename-heading', () => {
  test('section comments stay; a comment on the heading text covers the new title', () => {
    const idea = plan()
    const r = run(
      idea,
      [
        { id: 'section', anchor: { kind: 'section', file: 'f1', section: 's4' } },
        { id: 'heading', anchor: textAnchor(idea, 'f1', 'Risks') },
      ],
      { command: 'rename-heading', target: 's4', title: 'Hazards' },
    )
    expect(source(r)).toContain('## Hazards\n')
    expect(ids(r)).toEqual(plan().files[0]!.unitIds)
    expect(outcome(r, 'section')).toEqual({ state: 'exact', quote: null, file: 'f1' })
    expect(outcome(r, 'heading')).toEqual({ state: 'changed', quote: 'Hazards', file: 'f1' })
  })

  test('setext and closed ATX headings', () => {
    const idea = createIdea([{ path: 'a.md', source: 'Title\n=====\n\n## Old ##\n' }])
    expect(source(run(idea, [], { command: 'rename-heading', target: 's2', title: 'New title' }))).toBe(
      'New title\n=====\n\n## Old ##\n',
    )
    expect(source(run(idea, [], { command: 'rename-heading', target: 's3', title: 'New' }))).toBe(
      'Title\n=====\n\n## New ##\n',
    )
  })
})

describe("a heading's level", () => {
  test("changes with its title or alone; its ID, its section's comments and a comment on its words stay", () => {
    const idea = plan()
    const r = run(
      idea,
      [
        { id: 'section', anchor: { kind: 'section', file: 'f1', section: 's4' } },
        { id: 'heading', anchor: textAnchor(idea, 'f1', 'Risks') },
      ],
      { command: 'rename-heading', target: 's4', title: 'Risks', level: 3 },
    )
    expect(source(r)).toContain('### Risks\n')
    expect(ids(r)).toEqual(plan().files[0]!.unitIds)
    expect(outcome(r, 'section')).toEqual({ state: 'exact', quote: null, file: 'f1' })
    expect(outcome(r, 'heading')).toEqual({ state: 'exact', quote: 'Risks', file: 'f1' })
    expect(source(run(plan(), [], { command: 'rename-heading', target: 's4', title: 'Hazards', level: 1 }))).toContain(
      '\n# Hazards\n',
    )
  })

  test("its section follows the new level's nesting", () => {
    // Risks up to level 1: Costs, at level 2, is now inside it rather than inside Plan
    const r = ok(run(plan(), [], { command: 'rename-heading', target: 's4', title: 'Risks', level: 1 }))
    const parsed = parseMarkdown(r.idea.files[0]!.source)
    const risks = parsed.sections.find((s) => parsed.units[s.heading]!.level === 1 && s.heading > 0)!
    expect(parsed.units[risks.last]!.end).toBe(parsed.units.at(-1)!.end)
  })

  test('a setext heading becomes # headings when its level changes', () => {
    const idea = createIdea([{ path: 'a.md', source: 'Title\n=====\n\nText.\n' }])
    expect(source(run(idea, [], { command: 'rename-heading', target: 's2', title: 'Title', level: 2 }))).toBe(
      '## Title\n\nText.\n',
    )
  })
})

describe('set-section', () => {
  test("rewrites the section's own body; surviving text keeps its comments, rewritten text's become outdated", () => {
    const idea = plan()
    const r = run(
      idea,
      [
        { id: 'rewritten', anchor: textAnchor(idea, 'f1', 'It might rain on the day.') },
        { id: 'survives', anchor: textAnchor(idea, 'f1', 'Budget') },
        { id: 'section', anchor: { kind: 'section', file: 'f1', section: 's4' } },
      ],
      {
        command: 'set-section',
        target: 's4',
        markdown: 'Storms are likely in spring.\n\n- Weather\n- Budget\n- Staff',
      },
    )
    expect(source(r)).toContain('## Risks\n\nStorms are likely in spring.\n\n- Weather\n- Budget\n- Staff\n\n## Costs')
    expect(outcome(r, 'rewritten').state).toBe('outdated')
    expect(outcome(r, 'survives')).toEqual({ state: 'exact', quote: 'Budget', file: 'f1' })
    expect(outcome(r, 'section').state).toBe('exact')
    // the surviving list items keep their IDs; the new one gets a new ID
    expect(ids(r)).toEqual(['s2', 'b3', 's4', 'b5', 'b6', 'b7', 'b10', 's8', 'b9'])
  })

  test('keeps subsections, and refuses a body with headings', () => {
    const idea = createIdea([{ path: 'a.md', source: '# A\n\nOld body.\n\n## B\n\nKept.\n' }])
    expect(source(run(idea, [], { command: 'set-section', target: 's2', markdown: 'New body.' }))).toBe(
      '# A\n\nNew body.\n\n## B\n\nKept.\n',
    )
    const r = run(idea, [], { command: 'set-section', target: 's2', markdown: 'Text\n\n## Sneaky' })
    expect(r).toEqual({ ok: false, conflicts: [expect.objectContaining({ reason: 'invalid' })] })
  })
})

describe('insert', () => {
  test('after a block, before a section, inside a list, and at either end of a file', () => {
    const idea = plan()
    expect(source(run(idea, [], { command: 'insert', at: { after: 'b3' }, markdown: 'New paragraph.' }))).toContain(
      'lazy dog.\n\nNew paragraph.\n\n## Risks',
    )
    expect(
      source(run(idea, [], { command: 'insert', at: { before: 's8' }, markdown: '## Timeline\n\nSoon.' })),
    ).toContain('- Budget\n\n## Timeline\n\nSoon.\n\n## Costs')
    expect(source(run(idea, [], { command: 'insert', at: { after: 'b6' }, markdown: '- Staff' }))).toContain(
      '- Weather\n- Staff\n- Budget\n',
    )
    expect(source(run(idea, [], { command: 'insert', at: { start: 'f1' }, markdown: 'Draft.' }))).toStartWith(
      'Draft.\n\n# Plan\n',
    )
    expect(source(run(idea, [], { command: 'insert', at: { end: 'f1' }, markdown: 'The end.' }))).toEndWith(
      'Cheap enough.\n\nThe end.\n',
    )
  })

  test('inserted text gets new IDs and nothing else changes', () => {
    const idea = plan()
    const r = run(idea, [{ id: 'c1', anchor: textAnchor(idea, 'f1', 'Cheap') }], {
      command: 'insert',
      at: { after: 'b6' },
      markdown: '- Staff',
    })
    expect(ids(r)).toEqual(['s2', 'b3', 's4', 'b5', 'b6', 'b10', 'b7', 's8', 'b9'])
    expect(outcome(r, 'c1').state).toBe('exact')
  })

  test('next to a nested list item, the new item is indented to match', () => {
    const idea = createIdea([{ path: 'a.md', source: '- one\n  - nested\n- two\n' }])
    expect(source(run(idea, [], { command: 'insert', at: { after: 'b3' }, markdown: '- also nested' }))).toBe(
      '- one\n  - nested\n  - also nested\n- two\n',
    )
  })
})

describe('files', () => {
  test('rename, create and delete', () => {
    const idea = createIdea([
      { path: 'a.md', source: '# A\n' },
      { path: 'b.md', source: '# B\n' },
    ])
    const comments: Comment[] = [
      { id: 'on-a', anchor: { kind: 'file', file: 'f1' } },
      { id: 'on-b', anchor: { kind: 'file', file: 'f3' } },
      { id: 'on-idea', anchor: { kind: 'idea' } },
    ]
    const r = ok(
      run(
        idea,
        comments,
        { command: 'rename-file', file: 'f1', path: 'docs/a.md' },
        { command: 'delete-file', file: 'f3' },
        { command: 'create-file', path: 'c.md', markdown: 'New.' },
      ),
    )
    expect(r.idea.files.map((f) => [f.id, f.path])).toEqual([
      ['f1', 'docs/a.md'],
      ['f5', 'c.md'],
    ])
    expect(r.comments).toEqual([
      { id: 'on-a', state: 'exact', anchor: { kind: 'file', file: 'f1' } },
      { id: 'on-b', state: 'outdated', anchor: null },
      // on the idea as a whole: whatever happens to its files
      { id: 'on-idea', state: 'exact', anchor: { kind: 'idea' } },
    ])
  })

  test('paths must be valid and unused', () => {
    const idea = createIdea([
      { path: 'a.md', source: '# A\n' },
      { path: 'b.md', source: '# B\n' },
    ])
    for (const path of ['B.md', '../x.md', 'notes.txt', '/abs.md']) {
      const r = run(idea, [], { command: 'create-file', path, markdown: '' })
      expect(r.ok).toBe(false)
    }
  })
})

describe('batches', () => {
  test('all or nothing: every failing step is reported, and nothing applies', () => {
    const r = run(
      plan(),
      [],
      { command: 'replace', in: 'b3', old: 'brown', new: 'red' },
      { command: 'delete', target: 'b404' },
      { command: 'replace', in: 'b5', old: 'purple', new: 'x' },
    )
    expect(r).toEqual({
      ok: false,
      conflicts: [
        expect.objectContaining({ step: 1, reason: 'not_found' }),
        expect.objectContaining({ step: 2, reason: 'no_match' }),
      ],
    })
  })

  test('a stale batch replays onto the latest version: it lands if it still applies, and conflicts if not', () => {
    // v2: someone changed the Risks paragraph after the batch was made from v1
    const v2 = ok(run(plan(), [], { command: 'replace', in: 'b5', old: 'rain', new: 'snow' })).idea
    const stale = run(v2, [], { command: 'replace', in: 'b5', old: 'might rain', new: 'will rain' })
    expect(stale).toEqual({ ok: false, conflicts: [expect.objectContaining({ step: 0, reason: 'no_match' })] })
    const stillApplies = run(v2, [], { command: 'replace', in: 'b9', old: 'Cheap', new: 'Affordable' })
    expect(source(stillApplies)).toContain('It might snow on the day.')
    expect(source(stillApplies)).toContain('Affordable enough.')
  })

  test('`expect` conflicts when the target changed', () => {
    const idea = plan()
    expect(run(idea, [], { command: 'delete', target: 'b5', expect: 'It might rain on the day.' }).ok).toBe(true)
    expect(run(idea, [], { command: 'delete', target: 'b5', expect: 'It might snow.' })).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({ reason: 'expect_mismatch' })],
    })
  })

  test('steps record the comments they address, which must exist', () => {
    const idea = plan()
    const comments: Comment[] = [{ id: 'c12', anchor: textAnchor(idea, 'f1', 'Cheap') }]
    const r = ok(
      run(idea, comments, { command: 'replace', in: 'b9', old: 'Cheap', new: 'Affordable', addresses: ['c12'] }),
    )
    expect(r.steps).toEqual([{ step: 0, command: 'replace', addresses: ['c12'] }])
    const bad = run(idea, comments, { command: 'replace', in: 'b9', old: 'Cheap', new: 'x', addresses: ['c99'] })
    expect(bad).toEqual({ ok: false, conflicts: [expect.objectContaining({ reason: 'invalid' })] })
  })

  test('IDs are never reused', () => {
    const r = ok(
      run(plan(), [], { command: 'delete', target: 'b9' }, { command: 'insert', at: { end: 'f1' }, markdown: 'New.' }),
    )
    expect(r.idea.files[0]!.unitIds.at(-1)).toBe('b10')
    expect(r.idea.nextId).toBe(11)
  })
})
