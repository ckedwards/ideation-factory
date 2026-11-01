import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect, fn } from 'storybook/test'
import { CommentCard, type CommentInfo } from './CommentCard.tsx'
import { MarkdownView } from '../document/MarkdownView.tsx'
import { actors, devon, maya, NOW, riley } from '../stories/fixtures.ts'

const text = (markdown: string) => <MarkdownView tree={markdownTree(markdown)} variant="compact" />
const ago = (hours: number) => NOW - hours * 3_600_000

const base: CommentInfo = {
  id: 'c1',
  author: { kind: 'person', person: maya },
  at: ago(3),
  body: text('Should this say what happens to a change that was **made offline twice**?'),
  target: { kind: 'text', quote: 'replays it against the server, oldest first', section: 'Proposal' },
  resolved: false,
  replies: [],
}

const comments = {
  text: base,
  section: { ...base, id: 'c2', target: { kind: 'section', title: 'Proposal › Conflicts' } },
  file: { ...base, id: 'c3', target: { kind: 'file' }, body: text('A diagram of the sync flow would help here.') },
  withReplies: {
    ...base,
    id: 'c4',
    replies: [
      {
        id: 'r1',
        author: { kind: 'person', person: riley },
        at: ago(2),
        body: text('Good catch: the second one is a no-op, the server keeps a hash of each change.'),
      },
      {
        id: 'r2',
        author: actors.botForPerson,
        at: ago(1),
        body: text('Added a sentence to `### Sync endpoint` describing the hash.'),
      },
    ],
  },
  bot: {
    ...base,
    id: 'c5',
    author: actors.bot,
    body: text('This section names `POST /sync` but the overview calls it `/v2/sync`.'),
  },
  suggestion: {
    ...base,
    id: 'c6',
    author: { kind: 'person', person: devon },
    target: { kind: 'text', quote: 'p95 under 200ms' },
    body: text('Tighter wording:'),
    suggestion: { replacement: 'a p95 latency below 200 ms', state: 'open' },
  },
  suggestionAccepted: {
    ...base,
    id: 'c7',
    target: { kind: 'text', quote: 'recieve' },
    author: actors.botForInactive,
    body: text('Spelling.'),
    suggestion: { replacement: 'receive', state: 'accepted' },
    resolved: true,
  },
  outdated: {
    ...base,
    id: 'c8',
    target: { kind: 'text', quote: 'reuse the existing REST endpoints' },
    outdated: true,
    lastSeenIn: 2,
    madeOn: 2,
  },
  resolved: { ...base, id: 'c9', resolved: true },
} satisfies Record<string, CommentInfo>

const meta = {
  title: 'Comments/CommentCard',
  component: CommentCard,
  args: {
    comment: comments.text,
    onSelect: fn(),
    onReply: fn(),
    onResolve: fn(),
    onAccept: fn(),
    onReject: fn(),
    onViewInVersion: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '22rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommentCard>

export default meta
type Story = StoryObj<typeof meta>

export const OnText: Story = {}

export const OnSection: Story = { args: { comment: comments.section } }

export const OnWholeFile: Story = { args: { comment: comments.file } }

export const WithReplies: Story = { args: { comment: comments.withReplies } }

export const AutomatedBot: Story = { args: { comment: comments.bot } }

export const SuggestedEdit: Story = { args: { comment: comments.suggestion, canDecide: true } }

export const SuggestedEditNotAuthor: Story = { args: { comment: comments.suggestion } }

export const SuggestionAccepted: Story = { args: { comment: comments.suggestionAccepted } }

// Its text isn't in this version: the quote, and a way back to where it was
export const Outdated: Story = { args: { comment: comments.outdated } }

export const Resolved: Story = { args: { comment: comments.resolved } }

export const Active: Story = { args: { active: true } }

// Without Reply or Resolve, for someone who can only read
export const ReadOnly: Story = { render: (args) => <CommentCard comment={args.comment} /> }

// Reply opens a box; ⌘↵ sends it
export const Replying: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Reply' }))
    await userEvent.type(canvas.getByRole('textbox', { name: 'Reply' }), 'Agreed')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect(args.onReply).toHaveBeenCalledWith('Agreed')
  },
}

// A list of them, as the comments panel shows them
export const Thread: Story = {
  render: (args) => {
    const [active, setActive] = useState('c4')
    return (
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {[comments.withReplies, comments.bot, comments.suggestion, comments.outdated].map((comment) => (
          <CommentCard
            key={comment.id}
            {...args}
            comment={comment}
            active={comment.id === active}
            onSelect={() => setActive(comment.id)}
          />
        ))}
      </div>
    )
  },
}
