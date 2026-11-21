// Golden tests: the editor's blocks after some typing, cutting and pasting, turned into draft
// changes, and the draft those make: the Markdown it reads as, and where the comments are.
import { describe, expect, test } from 'bun:test'
import { blocksOfSource, type DraftChanges, draftChanges, type EditorBlock, type MovedWords } from './changes.ts'
import { buildDraft, type DraftChange, unitSource } from './draft.ts'
import { type Comment, createIdea, type Idea, textAnchor } from './idea.ts'
import { parseMarkdown } from './markdown.ts'

const PLAN = `# Plan

The first paragraph.

- one
- two
- three

| a | b |
| --- | --- |
| 1 | 2 |

## Risks

It might rain.

## Costs

Cheap.
`
// f1: s2 Plan, b3 first paragraph, b4 b5 b6 the items, b7 the table, s8 Risks, b9, s10 Costs, b11

const open = (...sources: string[]) => createIdea(sources.map((source, i) => ({ path: `${i}.md`, source })))

/** The file's blocks as the editor opens them. */
const blocks = (idea: Idea, file = 0): EditorBlock[] =>
  idea.files[file]!.unitIds.map((id) => ({ id, source: unitSource(idea, id)! }))
const b = (id: string | null, source: string): EditorBlock => ({ id, source })
const keep = (idea: Idea, id: string): EditorBlock => b(id, unitSource(idea, id)!)

/** The changes, applied to the draft as the server would: its files' Markdown, and the comments. */
function after(idea: Idea, files: Record<string, EditorBlock[]>, words: MovedWords[] = [], comments: Comment[] = []) {
  const result: DraftChanges = draftChanges(idea, files, words)
  if (!result.ok) {
    throw new Error(result.message)
  }
  const draft = buildDraft(
    idea,
    comments,
    result.changes.map((change, i) => ({ key: `k${i}`, change })),
  )
  expect(draft.problems).toEqual({})
  return {
    changes: result.changes,
    kinds: result.changes.map((c) => c.kind),
    sources: draft.idea.files.map((f) => f.source),
    comments: Object.fromEntries(draft.comments.map((c) => [c.id, c.state])),
  }
}

describe('nothing and simple changes', () => {
  test('the blocks as opened are no changes', () => {
    const idea = open(PLAN)
    expect(after(idea, { f1: blocks(idea) }).changes).toEqual([])
  })

  test('a block typed in is an edit, and a comment on words it kept stays', () => {
    const idea = open(PLAN)
    const list = blocks(idea).map((x) => (x.id === 'b3' ? b('b3', 'The first, edited paragraph.') : x))
    const r = after(idea, { f1: list }, [], [{ id: 'c', anchor: textAnchor(idea, 'f1', 'paragraph') }])
    expect(r.changes).toEqual([
      { kind: 'edit', id: 'b3', source: 'The first, edited paragraph.', was: 'The first paragraph.' },
    ])
    expect(r.comments).toEqual({ c: 'exact' })
  })

  test("a heading's #s change its level", () => {
    const idea = open(PLAN)
    const list = blocks(idea).map((x) => (x.id === 's8' ? b('s8', '### Risks') : x))
    expect(after(idea, { f1: list }).sources[0]).toContain('\n### Risks\n')
  })
})

describe('lists', () => {
  test('a new item at the end, between two, and an item deleted', () => {
    const idea = open(PLAN)
    const list = blocks(idea).flatMap((x) =>
      x.id === 'b4'
        ? [x, b(null, '- one and a half')]
        : x.id === 'b5'
          ? []
          : x.id === 'b6'
            ? [x, b(null, '- four')]
            : [x],
    )
    const r = after(idea, { f1: list })
    expect(r.sources[0]).toContain('The first paragraph.\n\n- one\n- one and a half\n- three\n- four\n\n| a | b |')
  })

  test('items reordered: one move, the rest stay', () => {
    const idea = open(PLAN)
    const list = blocks(idea)
    const order = [list[0]!, list[1]!, list[4]!, list[2]!, list[3]!, ...list.slice(5)]
    const r = after(idea, { f1: order }, [], [{ id: 'c', anchor: textAnchor(idea, 'f1', 'three') }])
    expect(r.kinds).toEqual(['move'])
    expect(r.sources[0]).toContain('- three\n- one\n- two\n')
    expect(r.comments).toEqual({ c: 'moved' })
  })

  test('a paragraph after a list is a paragraph, not more of the last item', () => {
    const idea = open(PLAN)
    const list = blocks(idea).flatMap((x) => (x.id === 'b6' ? [x, b(null, 'A paragraph after the list.')] : [x]))
    expect(after(idea, { f1: list }).sources[0]).toContain('- three\n\nA paragraph after the list.\n\n| a | b |')
  })

  test('several new items at once are one insertion, one under another', () => {
    const idea = open(PLAN)
    const list = blocks(idea).flatMap((x) => (x.id === 'b6' ? [x, b(null, '- four'), b(null, '- five')] : [x]))
    const r = after(idea, { f1: list })
    expect(r.kinds).toEqual(['insert'])
    expect(r.sources[0]).toContain('- three\n- four\n- five\n\n| a | b |')
  })

  test('a paragraph moved into the middle of a list... stays a paragraph between two lists', () => {
    const idea = open(PLAN)
    const list = blocks(idea).filter((x) => x.id !== 'b3')
    const at = list.findIndex((x) => x.id === 'b4')
    list.splice(at + 1, 0, keep(idea, 'b3'))
    const r = after(idea, { f1: list })
    expect(r.kinds).toEqual(['move'])
    expect(r.sources[0]).toContain('# Plan\n\n- one\n\nThe first paragraph.\n\n- two\n- three')
  })
})

describe('tables', () => {
  test('a cell edited is an edit of the table, changing that cell only', () => {
    const idea = open(PLAN)
    const list = blocks(idea).map((x) => (x.id === 'b7' ? b('b7', '| a | b |\n| --- | --- |\n| 1 | 22 |') : x))
    const r = after(idea, { f1: list }, [], [{ id: 'c', anchor: textAnchor(idea, 'f1', 'a') }])
    expect(r.sources[0]).toContain('| 1 | 22 |')
    expect(r.comments).toEqual({ c: 'exact' })
  })

  test('a table moved, as one block', () => {
    const idea = open(PLAN)
    const list = blocks(idea).filter((x) => x.id !== 'b7')
    list.push(keep(idea, 'b7'))
    const r = after(idea, { f1: list })
    expect(r.kinds).toEqual(['move'])
    expect(r.sources[0]!.trimEnd().endsWith('Cheap.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe(true)
  })
})

describe('sections and headings', () => {
  test('a whole section moved is one move, its comments with it', () => {
    const idea = open(PLAN)
    const list = blocks(idea)
    const costs = list.slice(-2)
    const order = [...list.slice(0, 6), ...costs, ...list.slice(6, -2)]
    const r = after(idea, { f1: order }, [], [{ id: 's', anchor: { kind: 'section', file: 'f1', section: 's10' } }])
    expect(r.kinds).toEqual(['move'])
    expect(r.sources[0]).toContain('| 1 | 2 |\n\n## Costs\n\nCheap.\n\n## Risks\n\nIt might rain.\n')
    expect(r.comments).toEqual({ s: 'moved' })
  })

  test('a block moved right under a heading goes under it, not after its section', () => {
    const idea = open(PLAN)
    const list = blocks(idea).filter((x) => x.id !== 'b3')
    list.splice(list.findIndex((x) => x.id === 's10') + 1, 0, keep(idea, 'b3'))
    expect(after(idea, { f1: list }).sources[0]).toContain('## Costs\n\nThe first paragraph.\n\nCheap.\n')
  })

  test("a heading deleted on its own leaves its section's text", () => {
    const idea = open(PLAN)
    const list = blocks(idea).filter((x) => x.id !== 's8')
    const r = after(idea, { f1: list }, [], [{ id: 'c', anchor: textAnchor(idea, 'f1', 'might rain') }])
    expect(r.sources[0]).toContain('| 1 | 2 |\n\nIt might rain.\n\n## Costs')
    expect(r.sources[0]).not.toContain('Risks')
    expect(r.comments.c).not.toBe('outdated')
  })

  test('a heading deleted with its text is one deletion', () => {
    const idea = open(PLAN)
    const list = blocks(idea).filter((x) => x.id !== 's8' && x.id !== 'b9')
    const r = after(idea, { f1: list })
    expect(r.kinds).toEqual(['delete'])
    expect(r.sources[0]).toContain('| 1 | 2 |\n\n## Costs')
  })

  test('new text right under a heading', () => {
    const idea = open(PLAN)
    const list = blocks(idea).flatMap((x) => (x.id === 's8' ? [x, b(null, 'New first words.')] : [x]))
    expect(after(idea, { f1: list }).sources[0]).toContain('## Risks\n\nNew first words.\n\nIt might rain.')
  })
})

describe('between files, and words', () => {
  test('a block cut from one file and pasted into another moves, with its comments', () => {
    const idea = open(PLAN, '# Notes\n\nA note.\n')
    const a = blocks(idea, 0).filter((x) => x.id !== 'b3')
    const notes = [...blocks(idea, 1), keep(idea, 'b3')]
    const r = after(
      idea,
      { f1: a, [idea.files[1]!.id]: notes },
      [],
      [{ id: 'c', anchor: textAnchor(idea, 'f1', 'first') }],
    )
    expect(r.kinds).toEqual(['move'])
    expect(r.sources[1]).toBe('# Notes\n\nA note.\n\nThe first paragraph.\n')
    expect(r.comments).toEqual({ c: 'moved' })
  })

  test('words the editor saw moved go with their comments; the rest of each block is edited after', () => {
    const idea = open(PLAN)
    const list = blocks(idea).map((x) =>
      x.id === 'b3' ? b('b3', 'The paragraph.') : x.id === 'b9' ? b('b9', 'It might first rain!') : x,
    )
    const r = after(
      idea,
      { f1: list },
      [{ from: 'b3', old: ' first', to: { in: 'b9', after: 'It might' } }],
      [{ id: 'c', anchor: textAnchor(idea, 'f1', 'first') }],
    )
    expect(r.kinds).toEqual(['move-text', 'edit'])
    expect(r.sources[0]).toContain('The paragraph.')
    expect(r.sources[0]).toContain('It might first rain!')
    expect(r.comments).toEqual({ c: 'moved' })
  })
})

describe('identities the editor got wrong', () => {
  test('a paste that split a block: the half that kept its text keeps its identity', () => {
    const idea = open(PLAN)
    // pasted at the start of b9 by a browser: b9 now holds the pasted text, its own text after it
    const list = blocks(idea).flatMap((x) =>
      x.id === 'b9' ? [b('b9', 'Pasted words.'), b(null, 'It might rain.')] : [x],
    )
    const r = after(idea, { f1: list }, [], [{ id: 'c', anchor: textAnchor(idea, 'f1', 'might rain') }])
    expect(r.kinds).toEqual(['insert'])
    expect(r.sources[0]).toContain('## Risks\n\nPasted words.\n\nIt might rain.')
    expect(r.comments).toEqual({ c: 'exact' })
  })

  test("an identity the draft doesn't know, or on two blocks, is new text", () => {
    const idea = open(PLAN)
    const list = [...blocks(idea), b('b3', 'A copy that kept the identity.'), b('b99', 'Unknown.')]
    const r = after(idea, { f1: list })
    expect(r.kinds).toEqual(['insert'])
    expect(r.sources[0]!.trimEnd().endsWith('Cheap.\n\nA copy that kept the identity.\n\nUnknown.')).toBe(true)
  })

  test('a block emptied is deleted', () => {
    const idea = open(PLAN)
    const list = blocks(idea).map((x) => (x.id === 'b3' ? b('b3', '  ') : x))
    const r = after(idea, { f1: list })
    expect(r.changes).toEqual([{ kind: 'delete', id: 'b3', was: 'The first paragraph.' } satisfies DraftChange])
  })
})

describe('the Markdown side', () => {
  const was = (idea: Idea) => {
    const file = idea.files[0]!
    return file.unitIds.map((id, i) => ({
      id,
      source: unitSource(idea, id)!,
      kind: parseMarkdown(file.source).units[i]!.kind,
    }))
  }

  test('unchanged blocks keep their identity; a changed one in its place keeps its own; new text is new', () => {
    const idea = open(PLAN)
    const edited = PLAN.replace('The first paragraph.', 'The first paragraph, edited.').replace(
      '## Risks',
      'A new paragraph.\n\n## Risks',
    )
    const blocks = blocksOfSource(was(idea), edited)
    expect(blocks.find((x) => x.source.startsWith('The first'))!.id).toBe('b3')
    expect(blocks.find((x) => x.source === 'A new paragraph.')!.id).toBeNull()
    expect(blocks.filter((x) => x.id !== null)).toHaveLength(was(idea).length)
    const r = after(idea, { f1: blocks })
    expect(r.kinds.sort()).toEqual(['edit', 'insert'])
    expect(r.sources[0]).toBe(edited)
  })

  test('a block deleted and two swapped', () => {
    const idea = open(PLAN)
    const edited = PLAN.replace(
      '## Risks\n\nIt might rain.\n\n## Costs\n\nCheap.\n',
      '## Costs\n\nCheap.\n\n## Risks\n',
    ).replace('The first paragraph.\n\n', '')
    const r = after(idea, { f1: blocksOfSource(was(idea), edited) })
    expect(r.sources[0]).toBe(edited)
    expect(r.kinds).toContain('delete')
  })
})

describe('moved words no longer where they were seen', () => {
  test('are left to the edits', () => {
    const idea = open(PLAN)
    const list = blocks(idea).map((x) =>
      x.id === 'b3' ? b('b3', 'The paragraph.') : x.id === 'b9' ? b('b9', 'It might first rain.') : x,
    )
    const r = after(idea, { f1: list }, [{ from: 'b3', old: ' missing', to: { in: 'b9', after: 'It might' } }])
    expect(r.kinds).toEqual(['edit', 'edit'])
    expect(r.sources[0]).toContain('It might first rain.')
  })
})

describe('a block made into another kind', () => {
  const made = (id: string, source: string) => {
    const idea = open('# Plan\n\nIntro.\n\n## Risks\n\nIt might rain.\n\n## Costs\n\nCheap.\n')
    // s2 Plan, b3 Intro, s4 Risks, b5, s6 Costs, b7
    return after(idea, { f1: blocks(idea).map((x) => (x.id === id ? b(id, source) : x)) })
  }

  test('a paragraph made a heading is the heading, in its place', () => {
    expect(made('b3', '## Intro.').sources[0]).toBe(
      '# Plan\n\n## Intro.\n\n## Risks\n\nIt might rain.\n\n## Costs\n\nCheap.\n',
    )
  })

  test("a heading made text is text, and its section's text stays", () => {
    expect(made('s4', 'Risks').sources[0]).toBe('# Plan\n\nIntro.\n\nRisks\n\nIt might rain.\n\n## Costs\n\nCheap.\n')
  })

  test('a heading made a list item is the list item', () => {
    expect(made('s4', '- Risks').sources[0]).toBe(
      '# Plan\n\nIntro.\n\n- Risks\n\nIt might rain.\n\n## Costs\n\nCheap.\n',
    )
  })

  test("a heading's level, or its words, is still the heading", () => {
    expect(made('s4', '### Risks').kinds).toEqual(['edit'])
  })
})

describe('a block with no words yet', () => {
  test('a new empty heading, bullet or quote is saved as one, with no words in it yet', () => {
    const idea = open('# Plan\n\nIntro.\n\n- one\n- two\n\nEnd.\n')
    // s2 Plan, b3 Intro, b4 b5 the list, b6 End
    const list = blocks(idea).flatMap((x) =>
      x.id === 'b3' ? [x, b(null, '##')] : x.id === 'b5' ? [x, b(null, '-')] : x.id === 'b6' ? [x, b(null, '>')] : [x],
    )
    const r = after(idea, { f1: list })
    expect(r.kinds).toEqual(['insert', 'insert', 'insert'])
    expect(r.sources[0]).toBe('# Plan\n\nIntro.\n\n##\n\n- one\n- two\n-\n\nEnd.\n\n>\n')
  })

  test('an empty bullet saved, then typed in, is the list item with its words', () => {
    const idea = open('# Plan\n\n- one\n- two\n-\n\nEnd.\n')
    // s2 Plan, b3 b4 b5 the list, b5 the empty item, b6 End
    const list = blocks(idea).map((x) => (x.id === 'b5' ? b('b5', '- three') : x))
    const r = after(idea, { f1: list })
    expect(r.kinds).toEqual(['edit'])
    expect(r.sources[0]).toBe('# Plan\n\n- one\n- two\n- three\n\nEnd.\n')
  })

  test('a heading saved with no words, then typed in, stays the heading', () => {
    const idea = open('# Plan\n\nIntro.\n\n##\n\nText.\n')
    // s2 Plan, b3 Intro, s4 the empty heading, b5 Text
    const list = blocks(idea).map((x) => (x.id === 's4' ? b('s4', '## ddd') : x))
    const r = after(idea, { f1: list })
    expect(r.kinds).toEqual(['edit'])
    expect(r.sources[0]).toBe('# Plan\n\nIntro.\n\n## ddd\n\nText.\n')
  })
})

describe('blocks moved out from under a heading', () => {
  test('move, and the heading stays where it is', () => {
    const idea = open(PLAN)
    // the list (b4 b5 b6) moved up, above "# Plan"'s first paragraph's end: past nothing but b3
    const list = blocks(idea)
    const items = list.filter((x) => ['b4', 'b5', 'b6'].includes(x.id!))
    const rest = list.filter((x) => !['b4', 'b5', 'b6'].includes(x.id!))
    rest.splice(1, 0, ...items)
    const r = after(idea, { f1: rest })
    expect(r.kinds.every((k) => k === 'move')).toBe(true)
    expect(r.changes.some((c) => c.kind === 'move' && c.id.startsWith('s'))).toBe(false)
    expect(r.sources[0]).toContain('# Plan\n\n- one\n- two\n- three\n\nThe first paragraph.')
  })

  test('a list moved out of its section, above the next heading up', () => {
    const idea = open('# Plan\n\nIntro.\n\n## Checks\n\n- one\n- two\n')
    // s2 Plan, b3 Intro, s4 Checks, b5 b6
    const list = blocks(idea)
    const order = [list[0]!, list[1]!, list[3]!, list[4]!, list[2]!]
    const r = after(idea, { f1: order })
    expect(r.sources[0]).toBe('# Plan\n\nIntro.\n\n- one\n- two\n\n## Checks\n')
  })
})
