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
import { actors, maya, NOW, sam } from '../stories/fixtures.ts'

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

// The document and the gutter side by side, scrolling as the idea page does
function Page({ initial = null }: { initial?: string | null }) {
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
            marks={comments.map((c) => ({
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
          notes={comments.map((c) => ({
            id: c.id,
            content: (
              <CommentCard comment={c} showTarget={false} active={c.id === active} onSelect={() => setActive(c.id)} />
            ),
          }))}
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

// The active one sits level with its text; the others make room
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
