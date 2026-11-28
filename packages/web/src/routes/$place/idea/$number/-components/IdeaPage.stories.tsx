import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { type CommentInfo, MarkdownView } from '@ideaf/ui'
import { actors, maya, NOW, riley } from '@ideaf/ui/fixtures'
import { atSize, shownHeight } from '@ideaf/ui/testing'
import { expect, fn, waitFor, within } from 'storybook/test'
import { IdeaPage, type PageComment } from './IdeaPage.tsx'
import { VersionBanner } from './VersionBanner.tsx'
import { DocToolbar } from './DocToolbar.tsx'
import { FileLine } from './FileLine.tsx'
import type { VersionListProps } from './VersionList.tsx'

const source = `# Offline sync

Field technicians lose signal in basements and plant rooms.

## Proposal

Queue changes on the device and send them, **oldest first**, when the
connection comes back.

## Rollout

Ship behind a flag, one team at a time.
`
const at = (quote: string) => ({ start: source.indexOf(quote), end: source.indexOf(quote) + quote.length })
const body = (text: string) => <MarkdownView tree={markdownTree(text)} variant="compact" />
const comment = (id: string, text: string, target: CommentInfo['target'], extra: Partial<CommentInfo> = {}) => ({
  id,
  author: { kind: 'person' as const, person: maya },
  at: NOW - 3_600_000,
  body: body(text),
  target,
  resolved: false,
  replies: [],
  ...extra,
})

const comments: PageComment[] = [
  {
    info: comment('c1', 'What about a change made offline twice?', { kind: 'text', quote: 'oldest first' }),
    place: { kind: 'text', ...at('oldest first') },
  },
  {
    info: comment(
      'c2',
      'Which team goes first?',
      { kind: 'section', title: 'Rollout' },
      { author: actors.botForPerson },
    ),
    place: { kind: 'section', heading: source.indexOf('## Rollout') },
  },
  {
    info: comment('c3', 'Is there a diagram of the flow?', { kind: 'file' }),
    place: { kind: 'file' },
  },
  {
    info: comment(
      'c4',
      'This contradicts the overview.',
      { kind: 'text', quote: 'every night' },
      { outdated: true, lastSeenIn: 2 },
    ),
    place: { kind: 'outdated' },
  },
  {
    info: comment('c5', 'Done.', { kind: 'text', quote: 'plant rooms' }, { resolved: true }),
    place: { kind: 'text', ...at('plant rooms') },
  },
]

// the same file two versions back: no rollout yet, and "in one batch"
const earlier = source
  .replace('lose signal in basements and plant rooms', 'lose signal in basements')
  .replace(', **oldest first**,', ' in one batch')
  .replace(/\n## Rollout[\s\S]*$/, '\n')

const versions: VersionListProps = {
  versions: [
    { number: 3, by: actors.person, at: NOW - 2 * 3_600_000, how: 'commands', steps: 3 },
    { number: 2, by: actors.botForPerson, at: NOW - 26 * 3_600_000, how: 'commands', steps: 1 },
    { number: 1, by: { kind: 'person', person: riley }, at: NOW - 72 * 3_600_000, how: 'created', steps: 0 },
  ],
  viewing: 3,
  latest: 3,
  base: null,
  viewHref: (n) => `#v${n}`,
  compareHref: (n) => `#compare${n}`,
}

const meta = {
  title: 'Ideas/IdeaPage',
  component: IdeaPage,
  parameters: { layout: 'fullscreen' },
  // each starts beside the text, whatever a story before it chose
  beforeEach: () => {
    try {
      localStorage.removeItem('ideaf:comments:view')
    } catch {
      // no storage: nothing kept
    }
  },
  args: {
    files: {
      files: [{ id: 'f1', path: 'plan.md', href: '#plan' }],
      current: 'plan.md',
      closed: [],
      onClosedChange: fn(),
    },
    source,
    comments,
    versions,
    canComment: true,
    onComment: fn(),
    onSectionComment: fn(),
    onReply: fn(),
    onResolve: fn(),
  },
} satisfies Meta<typeof IdeaPage>

export default meta
type Story = StoryObj<typeof meta>

/** Each in-text card whose text is in the window: most of it shows, not cut off by the column. */
async function cardsOnScreen(canvas: HTMLElement) {
  await waitFor(() => {
    for (const id of ['c1', 'c2']) {
      const text = canvas.querySelector(`[data-comment-id="${id}"]`)!.getBoundingClientRect()
      if (text.bottom < 0 || text.top > window.innerHeight) {
        continue
      }
      const note = canvas.querySelector(`.comment-gutter-note[data-note-id="${id}"]`)!
      expect(shownHeight(note), `${id}'s card shows`).toBeGreaterThan(note.getBoundingClientRect().height * 0.8)
    }
  })
}

// Text and section comments level with what they're on; the file's above them, and the one not in
// this version counted, in the list; a resolved one not shown. Each card whose text is in the window shows, whatever is above it in
// the column, and after its highlight is clicked
export const Comments: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('What about a change made offline twice?')).toBeVisible()
    await expect(page.getByText('Is there a diagram of the flow?')).toBeVisible()
    await expect(page.getByText(/1 comment not in this version/)).toBeVisible()
    await expect(page.queryByText('This contradicts the overview.')).toBeNull()
    await expect(page.queryByText('Done.')).toBeNull()
    // the marked text, and the section, carry their comments
    await expect(canvasElement.querySelector('mark[data-comment-id="c1"]')).toHaveTextContent('oldest first')
    await expect(canvasElement.querySelector('h2[data-comment-id="c2"]')).toHaveTextContent('Rollout')
    await cardsOnScreen(canvasElement)
    await userEvent.click(canvasElement.querySelector('mark[data-comment-id="c1"]')!)
    await cardsOnScreen(canvasElement)
  },
}

// The same on a wide screen, the three columns side by side
export const CommentsWide: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await atSize(1440, 900, async () => {
      await cardsOnScreen(canvasElement)
      await userEvent.click(canvasElement.querySelector('mark[data-comment-id="c1"]')!)
      await cardsOnScreen(canvasElement)
    })
  },
}

// A narrow screen: the comments come after the document, as the list: the file's, then each
// section's in the order of the text with what they're on, then the ones not in this version, rather
// than placed level with text that isn't beside them
export const CommentsNarrow: Story = {
  play: async ({ canvasElement }) => {
    await atSize(700, 900, async () => {
      await waitFor(() => expect(canvasElement.querySelector('.comment-gutter')).toBeNull())
      await expect(within(canvasElement).queryByRole('radiogroup', { name: 'Comments shown' })).toBeNull()
      const list = canvasElement.querySelector<HTMLElement>('.idea-comment-list')!
      await expect([...list.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
        'On the whole file · 1',
        'Proposal · 1',
        'Rollout · 1',
        'Not in this version · 1',
      ])
      const cards = within(list).getAllByRole('article')
      await expect(cards[1]).toHaveTextContent('oldest first')
      for (const card of cards) {
        card.scrollIntoView({ block: 'center' })
        await expect(shownHeight(card)).toBeGreaterThan(card.getBoundingClientRect().height * 0.8)
      }
    })
  },
}

// The list, chosen beside the filters: every comment with what it's on, grouped by where it is;
// choosing one opens it and brings its text into view. The choice is kept
export const List: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('radio', { name: 'List' }))
    const list = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('.idea-comment-list')
      expect(element).not.toBeNull()
      return element!
    })
    await expect(canvasElement.querySelector('.comment-gutter')).toBeNull()
    await expect(list.querySelectorAll('section')).toHaveLength(4)
    await expect(within(list).getByText('This contradicts the overview.')).toBeVisible()
    await userEvent.click(within(list).getByText('Which team goes first?'))
    await waitFor(() => expect(canvasElement.querySelector('h2[data-comment-id="c2"]')).toHaveClass('is-active'))
    await expect(localStorage.getItem('ideaf:comments:view')).toBe('list')
    // and back beside the text
    await userEvent.click(page.getByRole('radio', { name: 'Beside the text' }))
    await waitFor(() => expect(canvasElement.querySelector('.comment-gutter')).not.toBeNull())
  },
}

// Beside the text, the comments not in this version are counted, and a link opens the list
export const OutdatedInTheList: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Show in the list' }))
    await expect(await page.findByText('This contradicts the overview.')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
  },
}

// A section's comments are counted after its heading; open one and a rectangle goes round the whole
// section, from its heading to the end of the file here, filled while it's open
export const SectionBox: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const heading = canvasElement.querySelector<HTMLElement>('h2[data-comment-id="c2"]')!
    await expect(getComputedStyle(heading, '::after').content).toBe('"1"')
    await userEvent.click(heading)
    const box = await waitFor(() => {
      const element = window.document.querySelector<HTMLElement>('.comment-section-box.is-open')
      expect(element).not.toBeNull()
      return element!
    })
    // round the section, wherever the page has scrolled to
    await waitFor(() => {
      const rect = box.getBoundingClientRect()
      const last = canvasElement.querySelector('p:last-of-type')!.getBoundingClientRect()
      expect(rect.top).toBeLessThanOrEqual(heading.getBoundingClientRect().top)
      expect(rect.bottom).toBeGreaterThanOrEqual(last.bottom)
    })
    // put down: no longer filled (still drawn while the pointer's on its heading)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(window.document.querySelector('.comment-section-box.is-open')).toBeNull())
  },
}

// Ticks down the document's right edge, one per comment, where its text is in the file; a click on
// one opens its comment
export const Ticks: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const ticks = await within(window.document.body).findByRole('navigation', { name: 'Comments in this file' })
    const buttons = within(ticks).getAllByRole('button')
    await expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Maya Ortiz on the whole file',
      'Maya Ortiz on “oldest first”',
      'planbot for Riley Park on § Rollout',
    ])
    // in the order of the file, down the pane
    const tops = buttons.map((b) => b.getBoundingClientRect().top)
    await expect([...tops].sort((a, b) => a - b)).toEqual(tops)
    await userEvent.click(buttons[2]!)
    await waitFor(() => expect(canvasElement.querySelector('h2[data-comment-id="c2"]')).toHaveClass('is-active'))
  },
}

// Two comments on one section: its count says 2, and opening it opens both, one under the other,
// rather than the first over the second
export const SharedMark: Story = {
  args: {
    comments: [
      ...comments,
      {
        info: comment('c6', 'Start with the pilot team.', { kind: 'section', title: 'Rollout' }),
        place: { kind: 'section', heading: source.indexOf('## Rollout') },
      },
    ],
  },
  play: async ({ canvasElement, userEvent }) => {
    const heading = canvasElement.querySelector<HTMLElement>('h2[data-comment-ids="c2 c6"]')!
    await expect(getComputedStyle(heading, '::after').content).toBe('"2"')
    await userEvent.click(heading)
    const open = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('.comment-gutter-note.is-open')
      expect(element).not.toBeNull()
      return element!
    })
    await expect(within(open).getByText('Which team goes first?')).toBeVisible()
    await expect(within(open).getByText('Start with the pilot team.')).toBeVisible()
  },
}

// A block's count is on top of every mark around it: the topmost thing at its middle
export const CountOnTop: Story = {
  args: {
    comments: [
      ...comments,
      {
        info: comment('c7', 'Which devices?', { kind: 'block', label: 'Paragraph' }),
        place: { kind: 'block', start: source.indexOf('Field technicians'), end: source.indexOf('plant rooms.') + 12 },
      },
      {
        info: comment('c8', 'Name the flag.', { kind: 'section', title: 'Rollout' }),
        place: { kind: 'section', heading: source.indexOf('## Proposal') },
      },
    ],
  },
  play: async ({ canvasElement, userEvent }) => {
    // the section's rectangle drawn round the paragraph's neighbor, and the paragraph's lines grown
    await userEvent.click(canvasElement.querySelector<HTMLElement>('h2[data-comment-id="c8"]')!)
    const count = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('.md-block-count')
      expect(element).not.toBeNull()
      return element!
    })
    const box = count.getBoundingClientRect()
    await expect(window.document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)).toBe(count)
  },
}

// One comment open: the other cards fade, so it stands out, and come back while pointed at; and a
// section's rectangle stands clear of the blocks' counts
export const OthersFade: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const note = (id: string) =>
      canvasElement.querySelector<HTMLElement>(`.comment-gutter-note[data-note-id="${id}"]:not(.is-open)`)!
    await waitFor(() => expect(note('c1').style.top).not.toBe(''))
    const veil = (element: HTMLElement) => getComputedStyle(element, '::after').opacity
    await expect(veil(note('c1'))).toBe('0')
    await userEvent.click(canvasElement.querySelector<HTMLElement>('h2[data-comment-id="c2"]')!)
    await waitFor(() => expect(veil(note('c1'))).toBe('0.65'))
    const open = canvasElement.querySelector<HTMLElement>('.comment-gutter-note.is-open')!
    await expect(veil(open)).toBe('0')
    // put down: all back
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(veil(note('c1'))).toBe('0'))
  },
}

// The last section chosen in the contents comes to the top, though it's at the end of the file:
// there's room to scroll past the end
export const ScrollToTheLastSection: Story = {
  // as tall as the window, as in the app: the document scrolls in its pane
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement.querySelector<HTMLElement>('.idea-contents')!).getByText('Rollout'))
    const heading = canvasElement.querySelector<HTMLElement>('h2#rollout')!
    const pane = canvasElement.querySelector<HTMLElement>('.idea-page-document')!
    // near the top of the pane, below where the toolbar pins
    await waitFor(() => {
      const below = heading.getBoundingClientRect().top - pane.getBoundingClientRect().top
      expect(below).toBeGreaterThan(40)
      expect(below).toBeLessThan(100)
    })
  },
}

// Keys, as Google Docs has them: J and K move from comment to comment in the order of the text, R
// replies to the open one, E resolves it, Escape puts it down; none of them while typing
export const Keys: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const open = () => canvasElement.querySelector('.comment-card.is-active')?.textContent ?? null
    window.document.body.focus()
    // the file's own comment first, then those on its text
    await userEvent.keyboard('j')
    await waitFor(() => expect(open()).toContain('Is there a diagram of the flow?'))
    await userEvent.keyboard('j')
    await waitFor(() => expect(open()).toContain('What about a change made offline twice?'))
    await userEvent.keyboard('j')
    await waitFor(() => expect(open()).toContain('Which team goes first?'))
    await userEvent.keyboard('k')
    await waitFor(() => expect(open()).toContain('What about a change made offline twice?'))
    await userEvent.keyboard('e')
    await expect(args.onResolve).toHaveBeenCalledWith('c1', true)
    await userEvent.keyboard('r')
    // the reply box is the editor, which loads on first use
    const box = await page.findByRole('textbox', { name: 'Reply' }, { timeout: 5000 })
    // typed in the reply, the letters are words, not keys
    await userEvent.type(box, 'jk')
    await waitFor(() => expect(open()).toContain('What about a change made offline twice?'))
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(open()).toBeNull())
  },
}

// Replying from a comment
// The panel's filters: open, resolved or all
export const Filters: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    // resolved comments wait behind the filter
    await expect(page.queryByText('Done.')).toBeNull()
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Show' }), 'resolved')
    await expect(await page.findByText('Done.')).toBeVisible()
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Show' }), 'open')
    await waitFor(() => expect(page.queryByText('Done.')).toBeNull())
  },
}

// A comment on the whole file sits beside the file's line, as the first card, tagged File, rather than
// in a group of its own at the top of the column
export const FileComments: Story = {
  args: {
    banner: <FileLine path="plan.md" count={1} onComment={fn()} />,
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('· 1 comment on the file')).toBeVisible()
    await expect(page.queryByText('On the whole file')).toBeNull()
    const note = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('.comment-gutter-note[data-note-id="c3"]')
      expect(element).not.toBeNull()
      expect(element!.style.top).not.toBe('')
      return element!
    })
    // as near its line as the column lets it: under the panel's tabs and filters, shown whole
    await expect(shownHeight(note)).toBeGreaterThan(note.getBoundingClientRect().height * 0.8)
    await expect(within(note).getByText('File', { exact: true })).toBeVisible()
    // the first card in the column
    const tops = [...canvasElement.querySelectorAll<HTMLElement>('.comment-gutter-note')].map(
      (n) => n.getBoundingClientRect().top,
    )
    await expect(Math.min(...tops)).toBe(note.getBoundingClientRect().top)
  },
}

export const Reply: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getAllByRole('button', { name: 'Reply' })[0]!)
    await userEvent.type(await page.findByRole('textbox', { name: /reply/i }), 'Last write wins.')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(args.onReply).toHaveBeenCalledWith(expect.any(String), 'Last write wins.', false))
  },
}

const suggestions: PageComment[] = [
  {
    info: comment(
      'c6',
      '',
      { kind: 'text', quote: 'oldest first' },
      { suggestion: { old: '**oldest first**', replacement: '**in order**', state: 'open' } },
    ),
    place: { kind: 'text', ...at('oldest first') },
  },
  {
    info: comment(
      'c7',
      'Shorter.',
      { kind: 'text', quote: 'one team at a time' },
      { suggestion: { replacement: 'team by team', state: 'open' } },
    ),
    place: { kind: 'text', ...at('one team at a time') },
  },
]

// Suggested edits, for someone with edit access: each can be added to the
// draft or rejected, or all added together
export const Suggestions: Story = {
  args: { comments: suggestions, canDecide: true, onAddToDraft: fn(), onReject: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('2 suggested edits')).toBeVisible()
    // one that has formatting reads as it will, bold and all
    await expect(canvasElement.querySelector('.suggestion-diff ins strong')).toHaveTextContent('in order')
    await userEvent.click(page.getByRole('button', { name: 'Add all to draft' }))
    await expect(args.onAddToDraft).toHaveBeenCalledWith(['c6', 'c7'])
    await userEvent.click(page.getAllByRole('button', { name: 'Reject' })[1]!)
    await expect(args.onReject).toHaveBeenCalledWith('c7')
    // adding to the draft is the only way to accept one
    await expect(page.queryByRole('button', { name: /Accept/ })).toBeNull()
    await userEvent.click(page.getAllByRole('button', { name: 'Add to draft' })[0]!)
    await expect(args.onAddToDraft).toHaveBeenCalledWith(['c6'])
  },
}

// A reviewer sees suggestions, but can't decide on them
export const SuggestionsForAReviewer: Story = {
  args: { comments: suggestions, onAddToDraft: fn(), onReject: fn() },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.queryByText('2 suggested edits')).toBeNull()
    await expect(page.queryByRole('button', { name: 'Reject' })).toBeNull()
  },
}

// Someone who can only read: no replying, resolving or commenting on a selection
export const ReadOnly: Story = {
  args: { canComment: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Reply' })).toBeNull()
  },
}

// A new idea: nothing yet, and how to start
export const NoComments: Story = {
  args: { comments: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Select some text to comment on it/)).toBeVisible()
  },
}

// An idea with several files shows them as a tree, the one shown marked
export const SeveralFiles: Story = {
  args: {
    files: {
      files: [
        { id: 'f1', path: 'plan.md', href: '#plan' },
        { id: 'f2', path: 'design/sync-protocol.md', href: '#protocol' },
        { id: 'f3', path: 'notes/risks.md', href: '#risks' },
      ],
      current: 'plan.md',
      closed: [],
      onClosedChange: fn(),
    },
  },
  play: async ({ canvasElement }) => {
    const files = within(within(canvasElement).getByRole('navigation', { name: 'Files' }))
    await expect(files.getByRole('link', { name: 'plan.md' })).toHaveAttribute('aria-current', 'page')
  },
}

// An older version: read only, with the way back to the latest
export const OlderVersion: Story = {
  args: {
    source: earlier,
    canComment: false,
    comments: [],
    versions: { ...versions, viewing: 1 },
    banner: (
      <VersionBanner
        kind="older"
        version={1}
        latest={3}
        by={actors.person}
        at={NOW - 72 * 3_600_000}
        latestHref="#latest"
        changesHref="#changes"
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('Older version: v1')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to the latest' })).toHaveAttribute('href', '#latest')
  },
}

// Comparing: the file as a redline against v1, the sections that changed
// marked in the contents, the comments as a list, and the versions shown
export const Compare: Story = {
  args: {
    compare: { base: 1, source: earlier },
    versions: { ...versions, base: 1 },
    canComment: false,
    banner: (
      <DocToolbar
        path="plan.md"
        version={3}
        latest={3}
        compare={{ base: 1, stopHref: '#stop' }}
        compareWith={[]}
        onCompare={() => {}}
        source={false}
        onSource={() => {}}
        edit={null}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('button', { name: 'Comparing: v1 → v3' })).toBeVisible()
    // how much changed, and the way through it
    await expect(page.getByText(/^\d+ changes? in \d+ sections?$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next change' })).toBeVisible()
    await expect(canvasElement.querySelector('ins')).not.toBeNull()
    await expect(canvasElement.querySelector('del')).not.toBeNull()
    // the versions panel is open, the range from v1 to v3 marked
    await expect(page.getByRole('list', { name: 'Versions' })).toBeVisible()
    await expect(page.getByText('compared against')).toBeVisible()
  },
}
