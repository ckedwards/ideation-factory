import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect, fn, within } from 'storybook/test'
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

// A comment over text with formatting in it is one line under it: its pieces meet, rounded only at
// the comment's two ends, and the spaces between them stay
const formatted = "- Photos and ***maps aren't*** inverted.\n"
export const CommentAcrossFormatting: Story = {
  args: {
    tree: markdownTree(formatted),
    marks: [{ id: 'c1', start: formatted.indexOf('Photos'), end: formatted.indexOf('.') + 1 }],
  },
  play: async ({ canvasElement }) => {
    const pieces = [...canvasElement.querySelectorAll<HTMLElement>('mark[data-comment-id="c1"]')]
    await expect(pieces.length).toBeGreaterThan(1)
    await expect(pieces.map((p) => p.textContent).join('')).toBe("Photos and maps aren't inverted.")
    // each piece starts where the one before it ended
    for (let i = 1; i < pieces.length; i++) {
      const before = pieces[i - 1]!.getBoundingClientRect()
      const after = pieces[i]!.getBoundingClientRect()
      await expect(Math.abs(after.left - before.right)).toBeLessThan(1)
    }
    // rounded at the comment's ends only
    await expect(getComputedStyle(pieces[0]!).borderTopRightRadius).toBe('0px')
    await expect(getComputedStyle(pieces.at(-1)!).borderTopLeftRadius).toBe('0px')
  },
}

// Comments on whole blocks: two corner marks and a count, on a paragraph, a list item, a table, code
// and a quote. Pointing at a block grows its marks into a rectangle; its comment open, the rectangle
// fills. A section's comments are counted after its heading. Only the count opens a block's comment:
// clicking its words is for reading them
export const BlockComments: Story = {
  args: {
    onMarkClick: fn(),
    blockMarks: [
      { id: 'b1', block: sample.indexOf('Field technicians lose') },
      { id: 'b2', block: sample.indexOf('1. Ship behind a flag') },
      { id: 'b3', block: sample.indexOf('| Case') },
      { id: 'b4', block: sample.indexOf('```ts'), active: true },
      { id: 'b5', block: sample.indexOf('> We tried') },
      { id: 'b6', block: sample.indexOf('> We tried') },
    ],
    sectionMarks: [
      { id: 's1', heading: headingAt('## Rollout') },
      { id: 's2', heading: headingAt('## Rollout') },
    ],
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const marked = [...canvasElement.querySelectorAll<HTMLElement>('.md-block-mark')]
    // in the order of the document: the paragraph, the code, the table, the quote, the list item
    await expect(marked.map((m) => m.tagName)).toEqual(['P', 'DIV', 'DIV', 'BLOCKQUOTE', 'LI'])
    const quote = canvasElement.querySelector<HTMLElement>('blockquote.md-block-mark')!
    await expect(quote.dataset['commentIds']).toBe('b5 b6')
    await expect(within(quote).getByRole('button', { name: '2 comments on this block' })).toHaveTextContent('2')
    // at rest, corners; open, the whole rectangle (pointing grows it the same way, through --edge,
    // which a test's pointer doesn't set off), filled
    const paragraph = marked[0]!
    const code = canvasElement.querySelector<HTMLElement>('.md-code-marked')!
    const size = (element: HTMLElement) => getComputedStyle(element, '::before').backgroundSize
    await expect(size(paragraph).split(', ')[0]).toBe('12px 2px')
    await expect(size(code).split(', ')[0]).not.toBe('12px 2px')
    await expect(getComputedStyle(paragraph, '::after').backgroundColor).toBe('rgba(0, 0, 0, 0)')
    await expect(getComputedStyle(code, '::after').backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    // the lines over the block (code's fill can't cover them), the fill under its words
    await expect(getComputedStyle(code, '::before').zIndex).toBe('1')
    await expect(getComputedStyle(code, '::after').zIndex).toBe('-1')
    // the section's two comments, counted
    const rollout = canvasElement.querySelector<HTMLElement>('h2[data-comment-ids="s1 s2"]')!
    await expect(getComputedStyle(rollout, '::after').content).toBe('"2"')
    // the count opens the block's comment; its words don't
    await userEvent.click(paragraph.firstChild as HTMLElement)
    await expect(args.onMarkClick).not.toHaveBeenCalled()
    await userEvent.click(within(paragraph).getByRole('button', { name: '1 comment on this block' }))
    await expect(args.onMarkClick).toHaveBeenCalledWith('b1')
  },
}
