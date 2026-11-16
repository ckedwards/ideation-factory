import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { MarkdownView } from '@ideaf/ui'
import { actors, maya, NOW } from '@ideaf/ui/fixtures'
import { expect, fn, waitFor, within } from 'storybook/test'
import { type ActivityItem, IdeaOverview } from './IdeaOverview.tsx'
import { IdeaTabs } from './IdeaTabs.tsx'

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
    title: 'Offline-first sync for the field app',
    team: { name: 'Mobile' },
    status: { status: 'draft' },
    startedBy: actors.person,
    startedAt: hours(72),
    description: 'Field technicians lose signal in basements. Queue their changes, and send them **oldest first**.',
    tabs: <IdeaTabs current="overview" overview="#" files="#files" changes="#changes" />,
    sharingHref: '#sharing',
    activity,
    canComment: true,
    onReply: fn(),
    onResolve: fn(),
  },
} satisfies Meta<typeof IdeaOverview>

export default meta
type Story = StoryObj<typeof meta>

// Versions and comment threads in the order they happened
export const Activity: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('heading', { name: 'Offline-first sync for the field app' })).toBeVisible()
    await expect(page.getByText('Edited with 3 commands', { exact: false })).toBeVisible()
    await expect(page.getByRole('link', { name: 'What changed' })).toHaveAttribute('href', '#changes-1-2')
    await expect(page.getByRole('link', { name: 'notes/risks.md' })).toHaveAttribute('href', '#risks')
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
    await userEvent.type(page.getByRole('textbox', { name: /reply/i }), 'Agreed.')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(args.onReply).toHaveBeenCalledWith('c1', 'Agreed.'))
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
  },
}
