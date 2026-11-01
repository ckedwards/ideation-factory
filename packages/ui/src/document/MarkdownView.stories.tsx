import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect } from 'storybook/test'
import { MarkdownView, type MarkdownMark } from './MarkdownView.tsx'
import sample from '../stories/sample.md?raw'
import frontend from '../../../../docs/mvp/architecture-frontend.md?raw'

const tree = markdownTree(sample)

// A text comment's range, found by its quote
function markOn(quote: string, id: string, extra: Partial<MarkdownMark> = {}): MarkdownMark {
  const start = sample.indexOf(quote)
  return { id, start, end: start + quote.length, ...extra }
}

const headingAt = (text: string) => sample.indexOf(text)

const meta = {
  title: 'Document/MarkdownView',
  component: MarkdownView,
  args: { tree },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ paddingLeft: '2rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MarkdownView>

export default meta
type Story = StoryObj<typeof meta>

// Every kind of block: headings, lists, tasks, a table, code, a quote, an
// image, a footnote, and raw HTML shown as text
export const Document: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('script')).toBeNull()
  },
}

export const Comments: Story = {
  args: {
    marks: [
      markOn('stops working', 'c1'),
      markOn('oldest first', 'c2', { active: true }),
      markOn('it loses work', 'c3', { resolved: true }),
      // overlapping: the shorter one shows where they overlap
      markOn('keeps both and asks the second person to choose', 'c4'),
      markOn('the second person', 'c5'),
    ],
    sectionMarks: [
      { id: 's1', heading: headingAt('## Rollout') },
      { id: 's2', heading: headingAt('### Conflicts'), active: true },
    ],
  },
}

// Sections changed against the target get a rail in the margin
export const Changed: Story = {
  args: {
    changed: [{ start: headingAt('### Conflicts'), end: headingAt('## Rollout') }],
  },
}

// Internal links go through the page's resolver: a missing file is marked
export const Links: Story = {
  args: {
    resolveLink: (url) =>
      url.startsWith('#')
        ? { href: url, kind: 'internal' }
        : url.endsWith('.md')
          ? { href: `#file/${url}`, kind: 'missing' }
          : { href: url, kind: 'external' },
  },
}

// One of this repository's own design docs, as a long real document
export const RealDocument: Story = { args: { tree: markdownTree(frontend) } }
