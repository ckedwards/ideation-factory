/// <reference types="bun" />
// The table of contents' ids are the ones the document's headings get.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { markdownTree } from '@ideaf/core'
import { headings, MarkdownView } from './MarkdownView.tsx'

const source = `# Plan

## Sync endpoint

> ## Quoted heading

## Sync endpoint

### Rollout: *phase 1*
`

test("each heading's id, title, level and offset, matching the rendered document", () => {
  const tree = markdownTree(source)
  const found = headings(tree)
  expect(found).toEqual([
    { id: 'plan', title: 'Plan', level: 1, offset: 0 },
    { id: 'sync-endpoint', title: 'Sync endpoint', level: 2, offset: source.indexOf('## Sync') },
    { id: 'quoted-heading', title: 'Quoted heading', level: 2, offset: source.indexOf('## Quoted') },
    { id: 'sync-endpoint-1', title: 'Sync endpoint', level: 2, offset: source.lastIndexOf('## Sync') },
    { id: 'rollout-phase-1', title: 'Rollout: phase 1', level: 3, offset: source.indexOf('### Rollout') },
  ])
  const rendered = [...renderToStaticMarkup(<MarkdownView tree={tree} />).matchAll(/<h\d id="([^"]+)"/g)].map(
    (m) => m[1],
  )
  expect(rendered).toEqual(found.map((h) => h.id))
})

test('with a prefix, as when a page shows two files', () => {
  expect(headings(markdownTree('## Risks\n'), 'base-').map((h) => h.id)).toEqual(['base-risks'])
})
