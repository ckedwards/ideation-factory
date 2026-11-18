import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { type CommentInfo, MarkdownView, RelativeTime } from '@ideaf/ui'
import { maya, NOW, riley, sam } from '@ideaf/ui/fixtures'
import { expect, fn, waitFor, within } from 'storybook/test'
import { type ReaderPage, ReaderView, type ReaderViewProps } from './ReaderView.tsx'

const offline = `# Offline mode for the field app

## Why

Field teams lose signal in basements and on rural sites, and today the app shows a spinner and loses whatever they typed. Support logged 57 tickets about lost inspection notes last quarter.

## What changes

- Inspections, notes and photos are saved on the device first, and sent when there's a connection.
- A banner says the app is offline, and how many changes are waiting.

## Not in scope

Starting a new site visit offline: it needs the schedule from the server.
`
const sync = `# Sync states

## Waiting

A change made offline waits on the device, oldest first.

## Sent

Once the server has it, the change is marked sent and the banner's count drops.
`
// one long file: many sections, so it scrolls
const long = `# Being on call\n\n${[
  'The rotation',
  'When you are paged',
  'Talking to customers',
  'What you need',
  'What you get',
  'New joiners',
]
  .map(
    (h) =>
      `## ${h}\n\n${'Each person is on call one week in six, and hands over on Monday morning with a written handover. '.repeat(6)}\n`,
  )
  .join('\n')}`

const body = (text: string) => <MarkdownView tree={markdownTree(text)} variant="compact" />
const at = (source: string, quote: string) => ({
  start: source.indexOf(quote),
  end: source.indexOf(quote) + quote.length,
})
const thread = (
  id: string,
  text: string,
  target: CommentInfo['target'],
  extra: Partial<CommentInfo> = {},
): CommentInfo => ({
  id,
  author: { kind: 'person', person: maya },
  at: NOW - 3_600_000,
  body: body(text),
  target,
  resolved: false,
  replies: [],
  ...extra,
})

const twoFiles: ReaderPage[] = [
  {
    id: 'f1',
    path: 'offline.md',
    source: offline,
    comments: [
      {
        info: thread(
          'c1',
          'Name the months, so this still reads right next year.',
          { kind: 'text', quote: 'last quarter' },
          {
            author: { kind: 'person', person: riley },
            suggestion: { replacement: 'between July and September', state: 'open' },
          },
        ),
        place: { kind: 'text', ...at(offline, 'last quarter') },
      },
      {
        info: thread('c2', "Let's use the same banner as the web app's connection notice.", {
          kind: 'text',
          quote: 'A banner says the app is offline',
        }),
        place: { kind: 'text', ...at(offline, 'A banner says the app is offline') },
      },
      {
        info: thread(
          'c3',
          'How often does that happen?',
          { kind: 'text', quote: 'Starting a new site visit offline' },
          {
            author: { kind: 'person', person: sam },
            replies: [
              { id: 'r1', author: { kind: 'person', person: riley }, at: NOW - 1_800_000, body: body('Rarely.') },
            ],
          },
        ),
        place: { kind: 'text', ...at(offline, 'Starting a new site visit offline') },
      },
    ],
  },
  {
    id: 'f2',
    path: 'sync-states.md',
    source: sync,
    comments: [
      {
        info: thread('c4', 'Does the banner say which ones failed?', { kind: 'file' }),
        place: { kind: 'file' },
      },
    ],
  },
]

const oneLongFile: ReaderPage[] = [
  {
    id: 'f1',
    path: 'on-call.md',
    source: long,
    comments: ['The rotation', 'What you need', 'New joiners'].map((h, i) => ({
      info: thread(`l${i}`, `About “${h}”.`, { kind: 'section', title: h }),
      place: { kind: 'section' as const, heading: long.indexOf(`## ${h}`) },
    })),
  },
]

// the reader with its pages' threads in state, so resolving one takes it out
function Reader(props: Omit<ReaderViewProps, 'pages'> & { pages: ReaderPage[] }) {
  const [pages, setPages] = useState(props.pages)
  const without = (id: string) =>
    setPages((all) => all.map((p) => ({ ...p, comments: p.comments.filter((c) => c.info.id !== id) })))
  return (
    <ReaderView
      {...props}
      pages={pages}
      actions={{
        ...props.actions,
        onResolve: (id, resolved) => {
          props.actions.onResolve?.(id, resolved)
          without(id)
        },
        onReject: (id) => {
          props.actions.onReject?.(id)
          without(id)
        },
      }}
    />
  )
}

const meta = {
  title: 'Ideas/ReaderView',
  component: Reader,
  // the window the design was drawn for: the page list down the side, threads beside the sheets
  parameters: {
    layout: 'fullscreen',
    viewport: { options: { wide: { name: 'Wide', styles: { width: '1440px', height: '900px' }, type: 'desktop' } } },
  },
  globals: { viewport: { value: 'wide' } },
  args: {
    title: 'Offline mode for the field app',
    version: (
      <>
        v1 · <RelativeTime at={NOW - 22 * 3_600_000} />
      </>
    ),
    pages: twoFiles,
    file: 'offline.md',
    phase: 'still',
    onExit: fn(),
    onOpened: fn(),
    onLeft: fn(),
    actions: {
      canComment: true,
      canDecide: true,
      addToReview: true,
      onReply: fn(),
      onResolve: fn(),
      onAccept: fn(),
      onAddToDraft: fn(),
      onReject: fn(),
    },
  },
} satisfies Meta<typeof Reader>

export default meta
type Story = StoryObj<typeof meta>

const reader = () => within(document.body).getByRole('region', { name: 'Reader view' })

// Two files, a sheet each in one scroll, the pages' names down the left; comments off, the text clean
export const TwoFiles: Story = {
  play: async () => {
    const view = within(reader())
    const sheets = view.getAllByRole('article').filter((a) => a.classList.contains('reader-sheet'))
    await expect(sheets).toHaveLength(2)
    await expect(sheets[0]).toHaveTextContent('1 of 2')
    await expect(sheets[1]).toHaveTextContent('2 of 2')
    await expect(view.getByRole('button', { name: /Comments/ })).toHaveAttribute('aria-pressed', 'false')
    await expect(view.getByRole('button', { name: /Comments/ })).toHaveTextContent('4')
    // the threads are there, but out of reach until comments are on
    await expect(reader().querySelector('.reader-notes')).toHaveAttribute('inert')
    // the page being read is marked, with its sections under it
    const pages = within(view.getByRole('navigation', { name: 'Pages' }))
    await expect(pages.getByRole('link', { name: /offline\.md/ })).toHaveAttribute('aria-current', 'page')
    await expect(pages.getByRole('link', { name: /What changes/ })).toBeVisible()
  },
}

// Comments on: each thread beside its text, the highlights back, a suggested edit among them; and off again
export const TwoFilesWithComments: Story = {
  play: async ({ userEvent }) => {
    const view = within(reader())
    await userEvent.click(view.getByRole('button', { name: /Comments/ }))
    await expect(view.getByRole('button', { name: /Comments/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(reader().querySelector('.reader-notes')).not.toHaveAttribute('inert')
    const notes = within(view.getByRole('complementary', { name: 'Comments on offline.md' }))
    // they fade in, one after the other
    await waitFor(() => expect(notes.getByText('Suggested edit')).toBeVisible())
    const fileNotes = within(view.getByRole('complementary', { name: 'Comments on sync-states.md' }))
    await waitFor(() => expect(fileNotes.getByText('On the whole file')).toBeVisible())
    // threads don't overlap: each starts below the one above
    await waitFor(() => {
      const tops = [...reader().querySelectorAll<HTMLElement>('.reader-row:first-child .reader-note')].map((n) =>
        n.getBoundingClientRect(),
      )
      tops.sort((a, b) => a.top - b.top)
      for (let i = 1; i < tops.length; i++) {
        expect(tops[i]!.top).toBeGreaterThanOrEqual(tops[i - 1]!.bottom)
      }
    })
    await userEvent.click(view.getByRole('button', { name: /Comments/ }))
    await expect(reader().querySelector('.reader-notes')).toHaveAttribute('inert')
  },
}

// A thread's buttons take no room at rest; they open with focus in it, growing over what's below and moving
// nothing. (The pointer resting on it opens them by the same rule; a story's pointer can't trigger :hover.)
export const ButtonsOnFocus: Story = {
  play: async ({ userEvent }) => {
    const view = within(reader())
    await userEvent.click(view.getByRole('button', { name: /Comments/ }))
    const card = reader().querySelector<HTMLElement>('.reader-thread')!
    const actions = card.querySelector<HTMLElement>('.suggestion-actions')!
    await waitFor(() => expect(actions.getBoundingClientRect().height).toBe(0))
    const next = card.closest<HTMLElement>('.reader-note')!.nextElementSibling!
    await waitFor(() => expect(getComputedStyle(next).opacity).toBe('1'))
    const top = next.getBoundingClientRect().top
    within(card).getByRole('button', { name: 'Reply', hidden: true }).focus()
    await waitFor(() => expect(actions.getBoundingClientRect().height).toBeGreaterThan(0))
    await expect(within(card).getByRole('button', { name: 'Accept as a new version' })).toBeVisible()
    // nothing else moved
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(next.getBoundingClientRect().top).toBe(top)
  },
}

// Resolving a thread takes it and its highlight out
export const Resolving: Story = {
  play: async ({ args, userEvent }) => {
    const view = within(reader())
    await userEvent.click(view.getByRole('button', { name: /Comments/ }))
    await expect(reader().querySelector('[data-comment-id="c2"]')).not.toBeNull()
    const card = [...reader().querySelectorAll<HTMLElement>('.reader-thread')].find((t) =>
      t.textContent?.includes('same banner'),
    )!
    await userEvent.hover(card)
    await userEvent.click(within(card).getByRole('button', { name: 'Resolve' }))
    await expect(args.actions.onResolve).toHaveBeenCalledWith('c2', true)
    await waitFor(() => expect(reader().querySelector('[data-comment-id="c2"]')).toBeNull())
    await expect(view.getByRole('button', { name: /Comments/ })).toHaveTextContent('3')
  },
}

// A page's name in the list scrolls to its sheet, and Esc leaves
export const PagesAndEsc: Story = {
  play: async ({ args, userEvent }) => {
    const view = within(reader())
    const second = view.getByRole('link', { name: /sync-states\.md/ })
    await userEvent.click(second)
    await waitFor(() => expect(reader().scrollTop).toBeGreaterThan(0))
    await waitFor(() => expect(second).toHaveAttribute('aria-current', 'page'))
    await userEvent.keyboard('{Escape}')
    await expect(args.onExit).toHaveBeenCalledWith('sync-states.md')
  },
}

// One long file: one sheet, its sections in the list
export const OneLongFile: Story = {
  args: { title: 'Handbook: being on call', pages: oneLongFile, file: 'on-call.md' },
  play: async () => {
    const view = within(reader())
    await expect(view.getByText('1 of 1')).toBeVisible()
    await expect(within(view.getByRole('navigation', { name: 'Pages' })).getAllByRole('link')).toHaveLength(7)
  },
}

// The long file with comments on: a thread on a section sits level with its heading
export const OneLongFileWithComments: Story = {
  args: { title: 'Handbook: being on call', pages: oneLongFile, file: 'on-call.md' },
  play: async ({ userEvent }) => {
    const view = within(reader())
    await userEvent.click(view.getByRole('button', { name: /Comments/ }))
    await waitFor(() => {
      const heading = reader().querySelector<HTMLElement>('[data-comment-id="l1"]')!.getBoundingClientRect()
      const note = reader().querySelectorAll<HTMLElement>('.reader-note')[1]!.getBoundingClientRect()
      expect(Math.abs(note.top - (heading.top - 12))).toBeLessThan(2)
    })
  },
}
