import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { type CommentInfo, MarkdownView, RelativeTime } from '@ideaf/ui'
import { maya, NOW, riley, sam } from '@ideaf/ui/fixtures'
import { expect, fn, waitFor, within } from 'storybook/test'
import { type FocusPage, FocusView, type FocusViewProps } from './FocusView.tsx'

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

const twoFiles: FocusPage[] = [
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

const oneLongFile: FocusPage[] = [
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

// focus view with its pages' threads in state, so resolving one takes it out
function Focus(props: Omit<FocusViewProps, 'pages'> & { pages: FocusPage[] }) {
  const [pages, setPages] = useState(props.pages)
  const without = (id: string) =>
    setPages((all) => all.map((p) => ({ ...p, comments: p.comments.filter((c) => c.info.id !== id) })))
  return (
    <FocusView
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
  title: 'Ideas/FocusView',
  component: Focus,
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
      onAddToDraft: fn(),
      onReject: fn(),
    },
  },
} satisfies Meta<typeof Focus>

export default meta
type Story = StoryObj<typeof meta>

const region = () => within(document.body).getByRole('region', { name: 'Focus view' })

// Two files, a sheet each in one scroll, the pages' names down the left; comments off, the text clean
export const TwoFiles: Story = {
  play: async () => {
    const view = within(region())
    const sheets = view.getAllByRole('article').filter((a) => a.classList.contains('focus-sheet'))
    await expect(sheets).toHaveLength(2)
    await expect(sheets[0]).toHaveTextContent('1 of 2')
    await expect(sheets[1]).toHaveTextContent('2 of 2')
    const modes = within(view.getByRole('radiogroup', { name: 'Comments' }))
    await expect(modes.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    await expect(region().querySelector('.focus-count')).toHaveTextContent('4')
    // no comments beside the sheets, and none to reach
    await expect(region().querySelector('.focus-notes')).toHaveAttribute('inert')
    await expect(region().querySelector('.comment-gutter')).toBeNull()
    // the page being read is marked, with its sections under it
    const pages = within(view.getByRole('navigation', { name: 'Pages' }))
    await expect(pages.getByRole('link', { name: /offline\.md/ })).toHaveAttribute('aria-current', 'page')
    await expect(pages.getByRole('link', { name: /What changes/ })).toBeVisible()
  },
}

/** The comment opened, once it's been placed beside its text. */
const placedOpen = () =>
  waitFor(() => {
    const open = region().querySelector<HTMLElement>('.comment-gutter-note.is-open')
    expect(open).not.toBeNull()
    expect(open!.style.visibility).toBe('')
    expect(open!.style.top).not.toBe('')
    return open!
  })

/** Chooses how the comments show. */
async function show(mode: 'Off' | 'Selected' | 'All', userEvent: { click: (e: Element) => Promise<void> }) {
  const view = within(region())
  await userEvent.click(within(view.getByRole('radiogroup', { name: 'Comments' })).getByRole('radio', { name: mode }))
}

// All the comments, as the Files tab has them: each beside its text and fitted to the room, the
// highlights back, the file's own tagged File; a suggested edit, opened, in full; and off again
export const AllComments: Story = {
  play: async ({ userEvent }) => {
    const view = within(region())
    await show('All', userEvent)
    await expect(region().querySelector('.focus-notes')).not.toHaveAttribute('inert')
    const notes = within(view.getByRole('complementary', { name: 'Comments on offline.md' }))
    await waitFor(() => expect(notes.getByText(/Name the months/)).toBeVisible())
    await userEvent.click(region().querySelector<HTMLElement>('mark[data-comment-id="c1"]')!)
    await waitFor(() => expect(notes.getByText('Suggested edit')).toBeVisible())
    const fileNotes = within(view.getByRole('complementary', { name: 'Comments on sync-states.md' }))
    await waitFor(() => expect(fileNotes.getByText('File', { exact: true })).toBeVisible())
    await expect(view.getByText(/· 1 comment on the file/)).toBeVisible()
    // each level with its text, or under the one above: none overlap
    await waitFor(() => {
      const boxes = [
        ...region().querySelectorAll<HTMLElement>('.focus-row:first-child .comment-gutter-note:not(.is-open)'),
      ]
        .map((n) => n.getBoundingClientRect())
        .sort((x, y) => x.top - y.top)
      expect(boxes.length).toBeGreaterThan(1)
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i]!.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom - 0.5)
      }
    })
    await show('Off', userEvent)
    await expect(region().querySelector('.focus-notes')).toHaveAttribute('inert')
  },
}

// Only the selected comment: nothing beside the text until a highlight is chosen, then its comment
// alone, level with it
export const SelectedComment: Story = {
  play: async ({ userEvent }) => {
    const view = within(region())
    await show('Selected', userEvent)
    const notes = within(view.getByRole('complementary', { name: 'Comments on offline.md' }))
    await waitFor(() => expect(notes.getByText('Select a highlight to see its comment.')).toBeVisible())
    const mark = region().querySelector<HTMLElement>('mark[data-comment-id="c2"]')!
    await userEvent.click(mark)
    const card = await placedOpen()
    await expect(card).toHaveTextContent('same banner')
    await expect(
      region().querySelectorAll('.focus-row:first-child .comment-gutter-note:not(.is-open) .comment-card'),
    ).toHaveLength(0)
    // both found again: drawn anew as the comment opened
    await waitFor(() => {
      const open = region().querySelector<HTMLElement>('.comment-gutter-note.is-open')!
      const text = region().querySelector<HTMLElement>('mark[data-comment-id="c2"]')!
      expect(Math.abs(open.getBoundingClientRect().top - text.getBoundingClientRect().top)).toBeLessThan(4)
    })
  },
}

// Resolving a thread takes it and its highlight out
export const Resolving: Story = {
  play: async ({ args, userEvent }) => {
    await show('All', userEvent)
    await expect(region().querySelector('[data-comment-id="c2"]')).not.toBeNull()
    // opened, in full, with its buttons
    await userEvent.click(region().querySelector<HTMLElement>('mark[data-comment-id="c2"]')!)
    await expect(await placedOpen()).toHaveTextContent('same banner')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await userEvent.click(within(await placedOpen()).getByRole('button', { name: 'Resolve' }))
    await expect(args.actions.onResolve).toHaveBeenCalledWith('c2', true)
    await waitFor(() => expect(region().querySelector('[data-comment-id="c2"]')).toBeNull())
    await expect(region().querySelector('.focus-count')).toHaveTextContent('3')
  },
}

// A page's name in the list scrolls to its sheet, and Esc leaves
export const PagesAndEsc: Story = {
  play: async ({ args, userEvent }) => {
    const view = within(region())
    const second = view.getByRole('link', { name: /sync-states\.md/ })
    await userEvent.click(second)
    await waitFor(() => expect(region().scrollTop).toBeGreaterThan(0))
    await waitFor(() => expect(second).toHaveAttribute('aria-current', 'page'))
    await userEvent.keyboard('{Escape}')
    await expect(args.onExit).toHaveBeenCalledWith('sync-states.md')
  },
}

// One long file: one sheet, its sections in the list
export const OneLongFile: Story = {
  args: { title: 'Handbook: being on call', pages: oneLongFile, file: 'on-call.md' },
  play: async () => {
    const view = within(region())
    await expect(view.getByText('1 of 1')).toBeVisible()
    await expect(within(view.getByRole('navigation', { name: 'Pages' })).getAllByRole('link')).toHaveLength(7)
  },
}

// The long file with all its comments: a thread on a section sits level with its heading
export const OneLongFileWithComments: Story = {
  args: { title: 'Handbook: being on call', pages: oneLongFile, file: 'on-call.md' },
  play: async ({ userEvent }) => {
    await show('All', userEvent)
    await waitFor(() => {
      const heading = region().querySelector<HTMLElement>('[data-comment-id="l1"]')!.getBoundingClientRect()
      const note = region()
        .querySelector<HTMLElement>('.comment-gutter-note[data-note-id="l1"]')!
        .getBoundingClientRect()
      expect(Math.abs(note.top - heading.top)).toBeLessThan(4)
    })
  },
}

// The last section chosen in the page list comes to the top, though it's near the end of the file:
// there's room to scroll past the end
export const ScrollToTheLastSection: Story = {
  args: { title: 'Handbook: being on call', pages: oneLongFile, file: 'on-call.md' },
  play: async ({ userEvent }) => {
    const view = within(region())
    await userEvent.click(
      within(view.getByRole('navigation', { name: 'Pages' })).getByRole('link', { name: /^New joiners/ }),
    )
    const heading = [...region().querySelectorAll<HTMLElement>('.focus-sheet h2')].find(
      (h) => h.textContent === 'New joiners',
    )!
    const top = region().querySelector<HTMLElement>('.focus-top')!.getBoundingClientRect().bottom
    await waitFor(() => expect(Math.abs(heading.getBoundingClientRect().top - top)).toBeLessThan(40))
  },
}

/**
 * Editing the draft here: Edit opens it, every sheet in the editor (a stand-in for DraftEditor, which
 * needs the server), the draft's panel and actions in place of the comments.
 */
function Editing(props: FocusViewProps & { onClose: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <FocusView
      {...props}
      editing={{
        label: 'Edit',
        onEdit: () => setOpen(true),
        open: open
          ? {
              label: 'Editing the draft, on v1',
              sheet: (page) => <textarea aria-label={`Editing ${page}`} defaultValue="…" />,
              panel: <p>No changes yet.</p>,
              actions: <button type="button">Commit as v2</button>,
              close: async () => {
                props.onClose()
                setOpen(false)
                return true
              },
            }
          : null,
      }}
    />
  )
}

// Edit opens the draft: each sheet's file in the editor, the comments' switch and threads gone, the
// draft beside the sheets; leaving saves and shuts the editor first
export const EditingTheDraft: Story = {
  args: { onClose: fn() } as never,
  render: (args) => <Editing {...(args as unknown as FocusViewProps & { onClose: () => void })} />,
  play: async ({ args, userEvent }) => {
    const view = within(region())
    await show('All', userEvent)
    await userEvent.click(view.getByRole('button', { name: 'Edit' }))
    await expect(view.getByText('Editing the draft, on v1')).toBeVisible()
    await expect(view.getByRole('textbox', { name: 'Editing f1' })).toBeVisible()
    await expect(view.getByRole('textbox', { name: 'Editing f2' })).toBeVisible()
    // the panel where the comments were, and no comments
    await expect(view.getByRole('complementary', { name: 'The draft' })).toHaveTextContent('No changes yet.')
    await expect(view.queryByRole('radiogroup', { name: 'Comments' })).toBeNull()
    await expect(region().querySelector('.comment-gutter')).toBeNull()
    await userEvent.click(view.getByRole('button', { name: /Exit focus view/ }))
    await waitFor(() => expect(args.onExit).toHaveBeenCalledWith('offline.md'))
    await expect((args as unknown as { onClose: () => void }).onClose).toHaveBeenCalled()
  },
}
