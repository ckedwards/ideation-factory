import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { InboxList, type InboxRowView } from './InboxList.tsx'

const maya = { kind: 'person' as const, person: { id: 'u-maya', name: 'Maya Chen' } }
const NOW = Date.now()
const rows: InboxRowView[] = [
  {
    id: 'i1',
    title: 'Retry payments that fail on a timeout',
    href: '/payments/idea/12',
    where: 'Payments',
    status: { status: 'requesting review' },
    reason: 'Review requested',
    actor: maya,
    update: 'commented: “Which timeout?”',
    newCount: 3,
    at: NOW - 5 * 60_000,
  },
  {
    id: 'i2',
    title: 'Offline sync for field technicians',
    href: '/mobile/idea/9',
    where: 'Mobile',
    status: { status: 'closed', reason: 'accepted' },
    reason: 'Author',
    actor: { kind: 'bot-for-person', bot: 'planbot', person: maya.person },
    update: 'approved it',
    newCount: 0,
    at: NOW - 26 * 3600_000,
  },
]

const meta = {
  title: 'Notifications/InboxList',
  component: InboxList,
  args: { rows, showing: 'inbox', onRead: fn(), onDone: fn(), onBack: fn(), empty: 'Nothing new.' },
} satisfies Meta<typeof InboxList>

export default meta
type Story = StoryObj<typeof meta>

// One row per idea: the unread one stands out; the toolbar acts on everything
export const Inbox: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('· 3 new')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Mark all as read' }))
    await expect(args.onRead).toHaveBeenCalledWith(null)
  },
}

// Ticking rows acts on those
export const Selecting: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('checkbox', { name: 'Select Offline sync for field technicians' }))
    await userEvent.click(page.getByRole('button', { name: 'Mark 1 as done' }))
    await expect(args.onDone).toHaveBeenCalledWith(['i2'])
    // acting clears the selection
    await expect(page.getByRole('button', { name: 'Mark all as done' })).toBeVisible()
  },
}

// The ideas marked done can go back to the inbox
export const Done: Story = {
  args: { showing: 'done' },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('checkbox', { name: 'Select all' }))
    await userEvent.click(page.getByRole('button', { name: 'Move 2 back to the inbox' }))
    await expect(args.onBack).toHaveBeenCalledWith(['i1', 'i2'])
  },
}

export const Empty: Story = { args: { rows: [] } }
