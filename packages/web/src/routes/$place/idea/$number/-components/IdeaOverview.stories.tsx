import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { MarkdownView } from '@ideaf/ui'
import { actors, maya, NOW } from '@ideaf/ui/fixtures'
import { expect, fn, waitFor, within } from 'storybook/test'
import { type ActivityItem, IdeaOverview } from './IdeaOverview.tsx'

const hours = (n: number) => NOW - n * 3_600_000
const body = (text: string) => <MarkdownView tree={markdownTree(text)} variant="compact" />

const activity: ActivityItem[] = [
  {
    kind: 'version',
    number: 1,
    by: actors.person,
    at: hours(72),
    how: 'created',
    steps: 0,
    href: '#v1',
    changesHref: null,
  },
  {
    kind: 'comment',
    at: hours(50),
    file: 'plan.md',
    href: '#plan',
    comment: {
      info: {
        id: 'c1',
        author: { kind: 'person', person: maya },
        at: hours(50),
        body: body('What about a change made offline twice?'),
        target: { kind: 'text', quote: 'oldest first', section: 'Sync › Conflicts' },
        resolved: false,
        replies: [{ id: 'c2', author: actors.person, at: hours(49), body: body('Last write wins, per field.') }],
      },
      place: { kind: 'file' },
    },
  },
  {
    kind: 'requested',
    at: hours(40),
    by: actors.person,
    who: 'Maya Chen (@maya)',
  },
  {
    kind: 'review',
    at: hours(30),
    by: { kind: 'person', person: maya },
    verdict: 'request-changes',
    version: 1,
    body: 'Say what happens to a change made offline twice.',
    dismissed: null,
  },
  {
    kind: 'version',
    number: 2,
    by: actors.botForPerson,
    at: hours(26),
    how: 'commands',
    steps: 3,
    href: '#v2',
    changesHref: '#changes-1-2',
  },
  {
    kind: 'comment',
    at: hours(3),
    file: 'notes/risks.md',
    href: '#risks',
    comment: {
      info: {
        id: 'c3',
        author: actors.bot,
        at: hours(3),
        body: body('This contradicts the overview.'),
        target: { kind: 'section', title: 'Rollout' },
        resolved: true,
        replies: [],
      },
      place: { kind: 'file' },
    },
  },
]

const meta = {
  title: 'Ideas/IdeaOverview',
  component: IdeaOverview,
  parameters: { layout: 'fullscreen' },
  args: {
    files: [
      { path: 'plan.md', href: '#plan' },
      { path: 'notes/risks.md', href: '#risks' },
    ],
    team: { name: 'Mobile' },
    startedBy: actors.person,
    startedAt: hours(72),
    latest: { number: 2, at: hours(26) },
    description: 'Field technicians lose signal in basements. Queue their changes, and send them **oldest first**.',
    address: 'mobile/idea/9',
    activity,
    canComment: true,
    onReply: fn(),
    onResolve: fn(),
    onComment: fn(),
    addToReview: true,
  },
} satisfies Meta<typeof IdeaOverview>

export default meta
type Story = StoryObj<typeof meta>

// Versions and comment threads in the order they happened
export const Activity: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    // its files, each a link to read it, and its details, on the left
    await expect(page.getByRole('navigation', { name: 'Files' })).toHaveTextContent('plan.md')
    await expect(page.getByText('mobile/idea/9')).toBeVisible()
    await expect(page.getByText('Edited with 3 commands', { exact: false })).toBeVisible()
    await expect(page.getByRole('link', { name: 'What changed' })).toHaveAttribute('href', '#changes-1-2')
    const feed = within(canvasElement.querySelector<HTMLElement>('.idea-activity')!)
    await expect(feed.getByRole('link', { name: 'notes/risks.md' })).toHaveAttribute('href', '#risks')
    // reviews are in the timeline too, with what they said
    await expect(page.getByText(/requested changes to v1/)).toBeVisible()
    await expect(page.getByText(/asked Maya Chen \(@maya\) to review/)).toBeVisible()
    await expect(page.getByText('Say what happens to a change made offline twice.')).toBeVisible()
  },
}

// A thread says what it's on: the quoted text and its section. A resolved one is folded to a line until it's shown
export const Context: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(canvasElement.querySelector('q.comment-quote')).toHaveTextContent('oldest first')
    await expect(page.getByText('§ Sync › Conflicts')).toBeVisible()
    await expect(page.queryByText('This contradicts the overview.')).toBeNull()
    await expect(page.getByText(/resolved · 1 comment/)).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Show the thread on “Rollout”' }))
    await expect(page.getByText('This contradicts the overview.')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Hide' }))
    await expect(page.queryByText('This contradicts the overview.')).toBeNull()
  },
}

// Replying from the overview
export const Reply: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getAllByRole('button', { name: 'Reply' })[0]!)
    await userEvent.type(await page.findByRole('textbox', { name: /reply/i }), 'Agreed.')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(args.onReply).toHaveBeenCalledWith('c1', 'Agreed.'))
  },
}

// A comment on the idea as a whole: no file to link to, and a box at the end of the activity for another
export const OnTheIdea: Story = {
  args: {
    activity: [
      ...activity,
      {
        kind: 'comment',
        at: hours(1),
        file: null,
        href: null,
        comment: {
          info: {
            id: 'c4',
            author: { kind: 'person', person: maya },
            at: hours(1),
            body: body('Worth trying with the Denver crew before it goes wider.'),
            target: { kind: 'idea' },
            resolved: false,
            replies: [],
          },
          place: { kind: 'file' },
        },
      },
    ],
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('Worth trying with the Denver crew before it goes wider.')).toBeVisible()
    await expect(page.queryByText('Whole file')).toBeNull()
    const box = await page.findByRole('textbox', { name: 'Comment on the idea' })
    // how to send is plain from the start: the button's there, waiting for something to send
    await expect(page.getByRole('button', { name: 'Comment' })).toBeDisabled()
    await userEvent.type(box, 'Agreed: Denver first.')
    await userEvent.click(page.getByRole('button', { name: 'Add to your review' }))
    await waitFor(() => expect(args.onComment).toHaveBeenCalledWith('Agreed: Denver first.', true))
    await waitFor(() => expect(box).toHaveTextContent(''))
    await userEvent.type(box, 'And Austin after.')
    await userEvent.click(page.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(args.onComment).toHaveBeenCalledWith('And Austin after.', false))
  },
}

// A new idea: no description, created and nothing since
export const New: Story = {
  args: { description: '', activity: activity.slice(0, 1) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No description.')).toBeVisible()
  },
}

// Someone who can only read
export const ReadOnly: Story = {
  args: { canComment: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Reply' })).toBeNull()
    await expect(within(canvasElement).queryByRole('textbox', { name: 'Comment on the idea' })).toBeNull()
  },
}
