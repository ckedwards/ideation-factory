import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { Membership } from './Membership.tsx'

const meta = {
  title: 'App/Membership',
  component: Membership,
  args: { role: null, requested: false, settingsHref: '/mobile/settings', onJoin: fn() },
} satisfies Meta<typeof Membership>

export default meta
type Story = StoryObj<typeof meta>

// Not in it: ask to join
export const Outside: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Ask to join' }))
    await expect(args.onJoin).toHaveBeenCalled()
  },
}

export const Asked: Story = { args: { requested: true } }

export const Member: Story = {
  args: { role: 'member' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link', { name: 'Settings' })).toBeNull()
  },
}

// Someone who can manage it: its settings
export const Admin: Story = {
  args: { role: 'admin' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/mobile/settings',
    )
  },
}
