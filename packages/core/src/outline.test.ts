import { expect, test } from 'bun:test'
import { createIdea } from './idea.ts'
import { outline } from './outline.ts'

test('lists each file’s sections and blocks with IDs, heading paths and source', () => {
  const idea = createIdea([{ path: 'plan.md', source: 'Preamble.\n\n# Plan\n\nIntro.\n\n## Risks\n\n- Rain\n' }])
  expect(outline(idea)).toEqual([
    {
      id: 'f1',
      path: 'plan.md',
      entries: [
        { id: 'b2', kind: 'paragraph', path: [], section: null, source: 'Preamble.' },
        { id: 's3', kind: 'heading', level: 1, path: ['Plan'], section: null, source: '# Plan' },
        { id: 'b4', kind: 'paragraph', path: ['Plan'], section: 's3', source: 'Intro.' },
        { id: 's5', kind: 'heading', level: 2, path: ['Plan', 'Risks'], section: 's3', source: '## Risks' },
        { id: 'b6', kind: 'list-item', path: ['Plan', 'Risks'], section: 's5', source: '- Rain' },
      ],
    },
  ])
})
