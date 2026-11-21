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
}: {
  initial?: string | null
  list?: CommentInfo[]
  // drawn at the size the gutter fits them to
  sized?: boolean
}) {
  const document = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(initial)
  // drawn again with nothing changed, as a page is when anything else on it changes
  const [, setDrawn] = useState(0)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 22rem', height: '40rem' }}>
      <div style={{ overflowY: 'auto', padding: '1rem 2rem' }}>
        <div ref={document}>
          <MarkdownView
            tree={tree}
            marks={list.map((c) => ({
              id: c.id,
              ...at((c.target as { quote: string }).quote),
              active: c.id === active,
            }))}
            onMarkClick={setActive}
          />
        </div>
      </div>
      <div style={{ padding: '0 1rem', borderLeft: '1px solid var(--rule)' }}>
        <Button size="sm" variant="ghost" onClick={() => setDrawn((n) => n + 1)}>
          Draw again
        </Button>
        <CommentGutter
          documentRef={document}
          active={active}
          notes={list.map((c) => {
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
