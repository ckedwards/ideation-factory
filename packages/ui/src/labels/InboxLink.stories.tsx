import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { InboxLink } from './InboxLink.tsx'

const meta = {
  title: 'Labels/InboxLink',
  component: InboxLink,
  args: { href: '/notifications', unread: 2 },
} satisfies Meta<typeof InboxLink>

export default meta
type Story = StoryObj<typeof meta>

// The envelope, with how many are unread on its corner; the word is in its name
export const Unread: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'Notifications, 2 unread' })
    await expect(link).toHaveAttribute('title', 'Notifications, 2 unread')
    await expect(link).toHaveTextContent('2')
  },
}

// None unread: no badge at all
export const None: Story = {
  args: { unread: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'Notifications' })).toHaveTextContent('')
  },
}

// A hundred or more is "99+", and the envelope stays where it was
export const Many: Story = {
  args: { unread: 140 },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'Notifications, 99+ unread' })
    await expect(link).toHaveTextContent('99+')
    await expect(link.getBoundingClientRect().width).toBe(32)
  },
}

// On the inbox itself, it looks current
export const OnTheInbox: Story = {
  args: { current: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link')).toHaveAttribute('aria-current', 'page')
  },
}
