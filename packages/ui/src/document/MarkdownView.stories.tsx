import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect, within } from 'storybook/test'
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
// image, a footnote, and raw HTML, drawn once it's made safe
export const Document: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('script')).toBeNull()
  },
}

// Raw HTML: drawn from a short allowlist and never run. An opening block and its closing one are drawn
// as one, with the Markdown between them inside; HTML that closes what it didn't open is its source
const html = `<div align="center" class="button" style="color: red" onclick="alert(1)"><b>Centered</b> <img src="https://example.com/x.png" alt="the logo" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></div>

<details><summary>Raw log</summary>

Some **Markdown** inside.

</details>

</span>`

export const RawHtml: Story = {
  args: { tree: markdownTree(html) },
  play: async ({ canvasElement }) => {
    const drawn = canvasElement.querySelector<HTMLElement>('.md-html-drawn')!
    // what's allowed stays
    await expect(drawn.querySelector('div[align="center"] b')).toHaveTextContent('Centered')
    // what isn't goes: script, handlers, styles, classes, images (their alt text stays) and script links
    await expect(canvasElement.querySelector('script')).toBeNull()
    await expect(canvasElement.querySelector('img')).toBeNull()
    const prose = canvasElement.querySelector('.prose')!
    await expect(prose.querySelector('[onclick], [onerror], [style], .button')).toBeNull()
    await expect(drawn).toHaveTextContent('[the logo]')
    await expect(within(drawn).getByText('bad')).not.toHaveAttribute('href')
    await expect(within(drawn).getByRole('link', { name: 'good' })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    )
    // the run: the Markdown between is drawn as Markdown, inside the details
    const details = canvasElement.querySelector('details')!
    await expect(details.querySelector('strong')).toHaveTextContent('Markdown')
    // a closing tag on its own is its source
    await expect(canvasElement.querySelector('pre.md-html')).toHaveTextContent('</span>')
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
