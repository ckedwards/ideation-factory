import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { type CommentInfo, MarkdownView } from '@ideaf/ui'
import { actors, maya, NOW, riley } from '@ideaf/ui/fixtures'
import { atSize, shownHeight } from '@ideaf/ui/testing'
import { expect, fn, waitFor, within } from 'storybook/test'
import { IdeaPage, type PageComment } from './IdeaPage.tsx'
import { VersionBanner } from './VersionBanner.tsx'
import { DocToolbar } from './DocToolbar.tsx'
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
  args: {
    files: [{ path: 'plan.md', href: '#plan', current: true }],
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

// Text and section comments level with what they're on; the rest above them;
// a resolved one not shown. Each card whose text is in the window shows, whatever is above it in
// the column, and after its highlight is clicked
export const Comments: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('What about a change made offline twice?')).toBeVisible()
    await expect(page.getByText('On the whole file')).toBeVisible()
    await expect(page.getByText('Not in this version')).toBeVisible()
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

// A narrow screen: the comments come after the document, the ones on text listed in the order
// of what they're on, each with its quote, rather than placed level with text that isn't beside them
export const CommentsNarrow: Story = {
  play: async ({ canvasElement }) => {
    await atSize(700, 900, async () => {
      await waitFor(() => expect(canvasElement.querySelector('.comment-gutter')).toBeNull())
      const list = canvasElement.querySelector<HTMLElement>('.idea-comment-list')!
      const cards = within(list).getAllByRole('article')
      await expect(cards.map((c) => c.textContent)).toEqual([
        expect.stringContaining('oldest first'),
        expect.stringContaining('Rollout'),
      ])
      for (const card of cards) {
        card.scrollIntoView({ block: 'center' })
        await expect(shownHeight(card)).toBeGreaterThan(card.getBoundingClientRect().height * 0.8)
      }
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
// The panel's filters: open, resolved or all; and a comment on the whole file at its top, one line until
// it's opened, above the comments level with their text
export const FiltersAndAFileComment: Story = {
  args: { onFileComment: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    // resolved comments wait behind the filter
    await expect(page.queryByText('Done.')).toBeNull()
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Show' }), 'resolved')
    await expect(await page.findByText('Done.')).toBeVisible()
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Show' }), 'open')
    // one line until it's opened, so the column starts with its comments
    const open = page.getByRole('button', { name: 'Comment on the whole file' })
    const gutter = canvasElement.querySelector('.comment-gutter')!
    await expect(open.getBoundingClientRect().top).toBeLessThan(gutter.getBoundingClientRect().top)
    await expect(open.getBoundingClientRect().height).toBeLessThan(32)
    await userEvent.click(open)
    const box = await page.findByRole('textbox', { name: 'Comment on the whole file' })
    await waitFor(() => expect(box).toHaveFocus())
    await userEvent.type(box, 'Needs a summary.')
    await userEvent.click(page.getByRole('button', { name: 'Comment' }))
    await expect(args.onFileComment).toHaveBeenCalledWith('Needs a summary.', false)
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

// An idea with several files lists them, the one shown marked
export const SeveralFiles: Story = {
  args: {
    files: [
      { path: 'plan.md', href: '#plan', current: true },
      { path: 'design/sync-protocol.md', href: '#protocol', current: false },
      { path: 'notes/risks.md', href: '#risks', current: false },
    ],
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
