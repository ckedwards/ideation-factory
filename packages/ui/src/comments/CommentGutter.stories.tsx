import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect, waitFor, within } from 'storybook/test'
import { Button } from '../controls/Button.tsx'
import { CommentCard, type CommentInfo } from './CommentCard.tsx'
import { CommentGutter } from './CommentGutter.tsx'
import { MarkdownView } from '../document/MarkdownView.tsx'
import sample from '../stories/sample.md?raw'
import type { Actor } from '../people/ActorLabel.tsx'
import { actors, devon, maya, NOW, riley, sam } from '../stories/fixtures.ts'

const tree = markdownTree(sample)
const at = (quote: string) => ({ start: sample.indexOf(quote), end: sample.indexOf(quote) + quote.length })
const body = (text: string) => <MarkdownView tree={markdownTree(text)} variant="compact" />

const comment = (id: string, quote: string, text: string, author: Actor = actors.person): CommentInfo => ({
  id,
  author,
  at: NOW - 3_600_000,
  body: body(text),
  target: { kind: 'text', quote },
  resolved: false,
  replies: [],
})

// three close together, so they have to make room for each other
const comments = [
  comment('c1', 'stops working', 'Is it all of the app, or just saving?', { kind: 'person', person: maya }),
  comment('c2', 'oldest first', 'What happens to a change that was made offline twice?'),
  comment('c3', 'replays it against the server', 'Replays, or merges?', actors.botForPerson),
  comment('c4', 'keeps both', 'Both in the same record, or two records?', { kind: 'person', person: sam }),
  comment('c5', 'Ship behind a flag', 'Which flag service?'),
]

// a crowded stretch: a dozen on the Conflicts section, three of them threads, and a quiet one after
const person = (who: typeof maya) => ({ kind: 'person' as const, person: who })
const thread = (c: CommentInfo, ...replies: [typeof maya, string][]): CommentInfo => ({
  ...c,
  replies: replies.map(([who, words], i) => ({
    id: `${c.id}r${i}`,
    author: person(who),
    at: NOW - (40 - i * 10) * 60_000,
    body: body(words),
  })),
})
const crowded = [
  comment('c1', 'stops working', 'Is it all of the app, or just saving?', person(maya)),
  thread(
    comment('k1', 'When two people change the same field', 'How often does this happen in the pilot?', person(sam)),
    [riley, 'Twice a week, on average.'],
    [sam, 'Worth saying here.'],
  ),
  comment('k2', 'the server keeps both', 'Both where? In the list, or only on the record?', person(devon)),
  comment('k3', 'asks the second person to choose', 'What if they never come back online?', person(riley)),
  comment('k4', 'Last write wins', 'Say what it was replaced with.', actors.botForPerson),
  comment('k5', 'it loses work', 'A number would help the case here.', person(maya)),
  thread(comment('k6', 'Same field', 'Same field, or same record?', person(sam)), [
    devon,
    'Same field. A record with two fields changed merges.',
  ]),
  comment('k7', 'Different fields', 'Merged in what order?', person(riley)),
  comment('k8', 'Restored as a copy', 'A copy with what name?', person(devon)),
  comment('k9', 'Three technicians lost', 'Can we link the pilot report?', person(maya)),
  comment('c5', 'Ship behind a flag', 'Which flag service?', person(sam)),
]

// The document and the gutter side by side, scrolling as the idea page does
function Page({
  initial = null,
  list = comments,
  sized = false,
  blocks = [],
}: {
  initial?: string | null
  list?: CommentInfo[]
  // comments on whole blocks, by where each block starts
  blocks?: Array<{ comment: CommentInfo; start: number }>
  // drawn at the size the gutter fits them to
  sized?: boolean
}) {
  const document = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(initial)
  // drawn again with nothing changed, as a page is when anything else on it changes
  const [, setDrawn] = useState(0)
  // comments whose words were taken out of the text (as editing does): their marks go first, the
  // comments only once the draft is saved
  const [gone, setGone] = useState<string[]>([])
  const shownList = list.filter((c) => !gone.includes(c.id))
  // room after the document for the comments to be read to their end, as the idea page gives
  const [reach, setReach] = useState(0)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 22rem', height: '40rem' }}>
      <div data-story-document style={{ overflowY: 'auto', padding: '1rem 2rem' }}>
        <div style={{ minHeight: reach > 0 ? `calc(${reach}px + 1rem)` : undefined }}>
          <div ref={document}>
            <MarkdownView
              tree={tree}
              marks={shownList.map((c) => ({
                id: c.id,
                ...at((c.target as { quote: string }).quote),
                active: c.id === active,
              }))}
              blockMarks={blocks.map((b) => ({ id: b.comment.id, block: b.start, active: b.comment.id === active }))}
              onMarkClick={setActive}
            />
          </div>
        </div>
      </div>
      <div style={{ padding: '0 1rem', borderLeft: '1px solid var(--rule)' }}>
        <Button size="sm" variant="ghost" onClick={() => setDrawn((n) => n + 1)}>
          Draw again
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setGone((was) => [...was, list[1]!.id])}>
          Take some words out
        </Button>
        <CommentGutter
          documentRef={document}
          active={active}
          notes={[...list, ...blocks.map((b) => b.comment)].map((c) => {
            const card = (size: 'full' | 'short' | 'line') => (
              <CommentCard
                comment={c}
                size={size}
                showTarget={false}
                active={c.id === active}
                onSelect={() => setActive(c.id)}
              />
            )
            return { id: c.id, content: sized ? card : card('full') }
          })}
          empty="No comments on the text of this file."
          onReach={setReach}
        />
      </div>
    </div>
  )
}

const meta = {
  title: 'Comments/CommentGutter',
  component: Page,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

// Each level with its text, pushed down where they'd overlap
export const Placed: Story = {
  play: async ({ canvasElement }) => {
    const notes = () => [...canvasElement.querySelectorAll<HTMLElement>('.comment-gutter-note')]
    await waitFor(() => expect(notes().every((note) => note.style.top !== '')).toBe(true))
    // in document order, none overlapping
    const boxes = notes().map((note) => note.getBoundingClientRect())
    for (let i = 1; i < boxes.length; i++) {
      await expect(boxes[i]!.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom)
    }
  },
}

// The open one sits level with its text, over the others, which stay where they were
export const Active: Story = {
  args: { initial: 'c3' },
  play: async ({ canvasElement }) => {
    const mark = canvasElement.querySelector<HTMLElement>('[data-comment-id="c3"]')!
    await waitFor(() => {
      const note = canvasElement.querySelector<HTMLElement>('[data-note-id="c3"]')!
      expect(Math.abs(note.getBoundingClientRect().top - mark.getBoundingClientRect().top)).toBeLessThan(2)
    })
  },
}

// Drawn again with nothing moved (anything else on the page changing), every note stays shown
export const DrawnAgain: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const notes = () => [...canvasElement.querySelectorAll<HTMLElement>('.comment-gutter-note')]
    await waitFor(() => expect(notes().every((note) => note.style.visibility === '')).toBe(true))
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Draw again' }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(notes().every((note) => getComputedStyle(note).visibility === 'visible')).toBe(true)
  },
}

// Pointing at a card lights its text, and pointing at the text lights its card
export const PointingTies: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const mark = canvasElement.querySelector<HTMLElement>('mark[data-comment-id="c2"]')!
    const card = () => canvasElement.querySelector<HTMLElement>('[data-note-id="c2"] .comment-card')!
    const other = () => canvasElement.querySelector<HTMLElement>('[data-note-id="c1"] .comment-card')!
    await waitFor(() => expect(card().closest<HTMLElement>('.comment-gutter-note')!.style.top).not.toBe(''))
    const markColor = () => getComputedStyle(mark).backgroundColor
    const border = (element: HTMLElement) => getComputedStyle(element).borderTopColor
    const atRest = { mark: markColor(), card: border(card()) }
    await userEvent.hover(card())
    await waitFor(() => expect(markColor()).not.toBe(atRest.mark))
    await userEvent.unhover(card())
    await waitFor(() => expect(markColor()).toBe(atRest.mark))
    await userEvent.hover(mark)
    await waitFor(() => expect(border(card())).not.toBe(atRest.card))
    await expect(border(other())).toBe(atRest.card)
  },
}

/** Each note's (or pile's) top, by its first comment. */
const tops = (canvas: HTMLElement) =>
  new Map(
    [...canvas.querySelectorAll<HTMLElement>('.comment-gutter-note:not(.is-open)')].map((note) => [
      note.dataset['noteId'] ?? note.dataset['placeOf'] ?? note.dataset['pile']!.split(' ')[0]!,
      Math.round(note.getBoundingClientRect().top),
    ]),
  )
const sizes = (canvas: HTMLElement) =>
  Object.fromEntries(
    [...canvas.querySelectorAll<HTMLElement>('.comment-gutter-note:not(.is-open)')].map((note) => [
      note.dataset['noteId'] ?? note.dataset['placeOf'] ?? note.dataset['pile'],
      note.dataset['size'],
    ]),
  )

/** Placed, and laid out: no two notes overlap. */
async function settled(canvas: HTMLElement) {
  await waitFor(() => {
    const notes = [...canvas.querySelectorAll<HTMLElement>('.comment-gutter-note:not(.is-open)')]
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.every((note) => note.style.top !== '' && note.style.visibility === '')).toBe(true)
  })
  const boxes = [...canvas.querySelectorAll<HTMLElement>('.comment-gutter-note:not(.is-open)')]
    .map((note) => note.getBoundingClientRect())
    .sort((a, b) => a.top - b.top)
  for (let i = 1; i < boxes.length; i++) {
    await expect(boxes[i]!.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom - 0.5)
  }
}

// A crowded stretch fitted to its room: the cards on the Conflicts section step down together to
// lines or a pile, so they stay near their text; the quiet ones before and after stay full
export const Fitted: Story = {
  args: { list: crowded, sized: true },
  play: async ({ canvasElement }) => {
    await settled(canvasElement)
    const fitted = sizes(canvasElement)
    await expect(fitted['c1']).toBe('full')
    await expect(fitted['c5']).toBe('full')
    await expect(Object.values(fitted).some((size) => size === 'line' || size === 'pile')).toBe(true)
  },
}

// A pile, pointed at, fans into its lines; choosing one opens it
export const PileFans: Story = {
  args: { list: crowded, sized: true },
  play: async ({ canvasElement, userEvent }) => {
    await settled(canvasElement)
    const pile = canvasElement.querySelector<HTMLElement>('.comment-gutter-note.is-pile')
    if (!pile) {
      return
    }
    await userEvent.hover(pile)
    const fan = await waitFor(() => {
      const element = pile.querySelector<HTMLElement>('.comment-pile-fan')
      expect(element).not.toBeNull()
      return element!
    })
    const ids = pile.dataset['pile']!.split(' ')
    await expect(fan.querySelectorAll('.comment-card.is-line')).toHaveLength(ids.length)
    // chosen while the pile is still pointed at (the test's pointer leaves the pile on its way into
    // the fan, which a browser's doesn't)
    fan.querySelector<HTMLElement>(`[data-note-id="${ids[1]}"] .comment-card`)!.click()
    await waitFor(() =>
      expect(canvasElement.querySelector(`.comment-gutter-note.is-open[data-note-id="${ids[1]}"]`)).not.toBeNull(),
    )
    // and the pile folds again under it
    await waitFor(() => expect(pile.querySelector('.comment-pile-fan')).toBeNull())
  },
}

/** Opens a crowded comment by its highlight, and gives the tops before and after. */
async function opening(canvas: HTMLElement, id: string, userEvent: { click: (e: Element) => Promise<void> }) {
  await settled(canvas)
  const before = tops(canvas)
  const sizesBefore = sizes(canvas)
  await userEvent.click(canvas.querySelector(`mark[data-comment-id="${id}"]`)!)
  const open = await waitFor(() => {
    const card = canvas.querySelector<HTMLElement>(`[data-note-id="${id}"] .comment-card.is-active`)
    expect(card).not.toBeNull()
    expect(card).not.toHaveClass('is-line')
    expect(card).not.toHaveClass('is-short')
    return card!
  })
  await new Promise((resolve) => setTimeout(resolve, 250))
  // opening never fits the sizes again
  // the others keep their sizes (pushing, the open one leaves its pile, which is otherwise the same)
  const others = (fitted: Record<string, string | undefined>) =>
    Object.fromEntries(
      Object.entries(fitted)
        .map(([key, size]) => [
          key
            .split(' ')
            .filter((one) => one !== id)
            .join(' '),
          size,
        ])
        .filter(([key]) => key !== ''),
    )
  await expect(others(sizes(canvas))).toEqual(others(sizesBefore))
  return {
    before,
    after: tops(canvas),
    open,
    mark: canvas.querySelector<HTMLElement>(`mark[data-comment-id="${id}"]`)!,
  }
}

// Opened: the open card is full, level with its text, drawn over the cards near it, which stay where
// they were
export const Opened: Story = {
  args: { list: crowded, sized: true },
  play: async ({ canvasElement, userEvent }) => {
    const { before, after, open, mark } = await opening(canvasElement, 'k5', userEvent)
    await expect(Math.abs(open.getBoundingClientRect().top - mark.getBoundingClientRect().top)).toBeLessThan(2)
    await expect(after).toEqual(before)
  },
}

// A block pointed at draws its rectangle, which can run into the count of the block under it: that
// count fades while the rectangle is drawn, so it doesn't read as a second count on this block
export const NeighborCountFades: Story = {
  args: {
    list: [],
    blocks: [
      {
        comment: { ...comment('t1', '', 'Add a row for edits.'), target: { kind: 'block', label: 'Table' } },
        start: sample.indexOf('| Case'),
      },
      {
        comment: { ...comment('q1', '', 'Which pilot?'), target: { kind: 'block', label: 'Quote' } },
        start: sample.indexOf('> We tried'),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const table = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('.md-block-mark[data-comment-ids="t1"]')
      expect(element).not.toBeNull()
      return element!
    })
    const quote = canvasElement.querySelector<HTMLElement>('.md-block-mark[data-comment-ids="q1"]')!
    const own = table.querySelector<HTMLElement>(':scope > .md-block-count')!
    const neighbor = quote.querySelector<HTMLElement>(':scope > .md-block-count')!
    await expect(neighbor).not.toHaveClass('is-faded')
    table.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    await waitFor(() => expect(neighbor).toHaveClass('is-faded'))
    await expect(own).not.toHaveClass('is-faded')
    table.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
    await waitFor(() => expect(neighbor).not.toHaveClass('is-faded'))
  },
}

// A comment's words taken out of the text while the page is fitted (as editing does, before the
// draft is saved): its mark goes before it does, and the gutter draws the rest without it
export const MarkGoes: Story = {
  args: { list: crowded, sized: true },
  play: async ({ canvasElement, userEvent }) => {
    await settled(canvasElement)
    const gone = crowded[1]!.id
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Take some words out' }))
    await waitFor(() => expect(canvasElement.querySelector(`[data-comment-id="${gone}"]`)).toBeNull())
    // the gutter sees the mark go a frame later, so its note is waited for rather than checked at once
    await waitFor(() =>
      expect(
        [...canvasElement.querySelectorAll<HTMLElement>('.comment-gutter-note')].some(
          (note) => note.dataset['noteId'] === gone || note.dataset['pile']?.split(' ').includes(gone),
        ),
      ).toBe(false),
    )
    await settled(canvasElement)
  },
}

// A thread too long for the window, opened and unfolded: its card ends at the window's foot and
// scrolls on its own, so its last reply can be read
export const LongThreadOpen: Story = {
  args: {
    initial: 'long',
    list: [
      {
        ...comment('long', 'stops working', 'Which parts stop working?', person(maya)),
        replies: Array.from({ length: 30 }, (_, i) => ({
          id: `long-r${i}`,
          author: person(i % 2 === 0 ? sam : riley),
          at: NOW - (60 - i) * 60_000,
          body: body(i === 29 ? 'The last word on it.' : `Reply ${i + 1}: saving, and the list of jobs with it.`),
        })),
      },
    ],
  },
  play: async ({ canvasElement, userEvent }) => {
    const open = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('.comment-gutter-note.is-open')
      expect(element).not.toBeNull()
      expect(element!.style.top).not.toBe('')
      return element!
    })
    await userEvent.click(within(open).getByRole('button', { name: '28 earlier replies' }))
    // all of it is drawn, running on below the window: it doesn't scroll on its own
    const last = within(open).getByText('The last word on it.')
    const scroller = canvasElement.querySelector<HTMLElement>('[data-story-document]')!
    await waitFor(() =>
      expect(last.getBoundingClientRect().top).toBeGreaterThan(scroller.getBoundingClientRect().bottom),
    )
    await expect(open.scrollHeight).toBeLessThanOrEqual(open.clientHeight + 1)
    // the document scrolls far enough to bring its end into view, the card going up with its text
    await waitFor(() => {
      scroller.scrollTop = scroller.scrollHeight
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(scroller.getBoundingClientRect().bottom)
    })
  },
}
