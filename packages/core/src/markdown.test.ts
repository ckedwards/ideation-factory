import { describe, expect, test } from 'bun:test'
import { markdownTree, parseMarkdown, plainIndexAt, plainLine } from './markdown.ts'

const kinds = (source: string) => parseMarkdown(source).units.map((u) => u.kind)
const texts = (source: string) => {
  const p = parseMarkdown(source)
  return p.units.map((u) => p.plain.text.slice(u.plainStart, u.plainEnd))
}

describe('units', () => {
  test('headings and the blocks between them, in order', () => {
    const source = `---
title: x
---
# Title

A paragraph.

- one
- two

> quoted

\`\`\`js
code()
\`\`\`

| a | b |
|---|---|
| 1 | 2 |

---

<div>html</div>

[ref]: https://example.com
`
    expect(kinds(source)).toEqual([
      'front-matter',
      'heading',
      'paragraph',
      'list-item',
      'list-item',
      'quote',
      'code',
      'table',
      'thematic-break',
      'html',
      'definition',
    ])
    expect(texts(source)).toEqual([
      '',
      'Title',
      'A paragraph.',
      'one',
      'two',
      'quoted',
      'code()',
      'a b 1 2',
      '',
      '',
      '',
    ])
  })

  test('a nested list item is its own unit; its parent covers it when deleted or moved', () => {
    const source = '- one\n  - nested\n- two\n'
    const { units } = parseMarkdown(source)
    expect(texts(source)).toEqual(['one', 'nested', 'two'])
    expect(source.slice(units[0]!.start, units[0]!.end)).toBe('- one')
    expect(source.slice(units[0]!.extentStart, units[0]!.extentEnd)).toBe('- one\n  - nested')
  })

  test('a list item with text after its nested list is one unit', () => {
    expect(texts('- one\n\n  - nested\n\n  after\n- two\n')).toEqual(['one nested after', 'two'])
  })

  test('sections nest by level, and a section body ends at its first subsection', () => {
    const { sections } = parseMarkdown('# A\n\nBody.\n\n## B\n\nMore.\n\n# C\n')
    expect(sections).toEqual([
      { heading: 0, level: 1, parent: null, bodyLast: 1, last: 3 },
      { heading: 2, level: 2, parent: 0, bodyLast: 3, last: 3 },
      { heading: 4, level: 1, parent: null, bodyLast: 4, last: 4 },
    ])
  })
})

describe('the plain-text form', () => {
  test('drops syntax and collapses whitespace, with units separated by a newline', () => {
    const p = parseMarkdown('# A *title*\n\nSome **bold**   and `code`,\nre-wrapped.\n')
    expect(p.plain.text).toBe('A title\nSome bold and code, re-wrapped.')
  })

  test('every character maps back to its source', () => {
    const source = 'Escaped \\* star, &amp; entity, [a link](https://x.y) and ![an image](i.png).\n'
    const p = parseMarkdown(source)
    expect(p.plain.text).toBe('Escaped * star, & entity, a link and .')
    for (let i = 0; i < p.plain.text.length; i++) {
      const ch = p.plain.text[i]!
      const at = source[p.plain.source[i]!]!
      if (ch === '*') {
        expect(at).toBe('\\')
      } else if (ch === '&') {
        expect(at).toBe('&')
      } else if (ch !== ' ') {
        expect(at).toBe(ch)
      }
    }
  })

  test('no two characters share a source offset', () => {
    const p = parseMarkdown('# A\n\n- one\n- two\n\n> a\n>\n> b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n')
    expect(new Set(p.plain.source).size).toBe(p.plain.source.length)
    for (let i = 0; i < p.plain.text.length; i++) {
      expect(plainIndexAt(p.plain, p.plain.source[i]!)).toBe(i)
    }
  })

  test('knows which unit each character belongs to', () => {
    const p = parseMarkdown('# A\n\nB\n')
    expect(p.plain.text).toBe('A\nB')
    expect(p.plain.unit).toEqual([0, -1, 1])
  })
})

describe('the syntax tree', () => {
  test("its blocks start and end where the file's units do, so the web app places comments where core does", () => {
    const source = '---\ntitle: x\n---\n\n# Title\n\nSome *text*.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nx\n```\n'
    const blocks = markdownTree(source).children.map((node) => [node.position?.start.offset, node.position?.end.offset])
    const units = parseMarkdown(source).units.map((unit) => [unit.start, unit.end])
    expect(blocks).toEqual(units)
  })
})

describe('a line of plain text', () => {
  test('reads as the Markdown does: no syntax, one line', () => {
    expect(plainLine('Use **`createIdea`**, see [the docs](https://example.com).\n\n- one\n- two\n\n> quoted')).toBe(
      'Use createIdea, see the docs. one two quoted',
    )
  })

  test('is the source when there is no text to read', () => {
    expect(plainLine('<details>\n</details>')).toBe('<details> </details>')
  })
})
