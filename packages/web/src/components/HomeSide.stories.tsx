import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { HomeSide } from './HomeSide.tsx'

const meta = {
  title: 'Pages/HomeSide',
  component: HomeSide,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '18rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    unread: [
      { id: 'i1', title: 'Offline mode for the field app', href: '/mobile/idea/1', count: 3 },
      { id: 'i2', title: 'Move background jobs to a queue', href: '/platform/idea/2', count: 1 },
    ],
    unreadTotal: 5,
    requests: [{ key: 'team:platform', name: 'Platform', href: '/platform/settings?tab=requests', count: 1 }],
    teams: [
      { handle: 'mobile', name: 'Mobile', watch: 'participating' },
      { handle: 'platform', name: 'Platform', watch: 'all' },
    ],
  },
} satisfies Meta<typeof HomeSide>

export default meta
type Story = StoryObj<typeof meta>

// Join requests first, then what's unread (with a way to the rest), then your teams
export const Busy: Story = {
  play: async ({ canvasElement }) => {
    const side = within(canvasElement)
    await expect(side.getByText('1 request to join')).toBeVisible()
    await expect(side.getByRole('link', { name: 'Offline mode for the field app' })).toHaveAttribute(
      'href',
      '/mobile/idea/1',
    )
    await expect(side.getByText('3 new')).toBeVisible()
    await expect(side.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/notifications')
    await expect(side.getByText('Watching all ideas')).toBeVisible()
  },
}

// Nothing waiting: no Needs you, and Unread says you're up to date
export const Quiet: Story = {
  args: { unread: [], unreadTotal: 0, requests: [], teams: [] },
  play: async ({ canvasElement }) => {
    const side = within(canvasElement)
    await expect(side.queryByText('Needs you')).toBeNull()
    await expect(side.getByText('You’re up to date.')).toBeVisible()
    await expect(side.getByText('You’re not in a team yet.')).toBeVisible()
  },
}
