import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { SubscribeButton } from './SubscribeButton.tsx'

const meta = {
  title: 'Ideas/SubscribeButton',
  component: SubscribeButton,
  args: { subscribed: true, reason: 'review-requested', onChange: fn() },
} satisfies Meta<typeof SubscribeButton>

export default meta
type Story = StoryObj<typeof meta>

export const Subscribed: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Unsubscribe' }))
    await expect(args.onChange).toHaveBeenCalledWith(false)
  },
}

export const NotSubscribed: Story = {
  args: { subscribed: false, reason: null },
  play: async ({ args, canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Subscribe' }))
    await expect(args.onChange).toHaveBeenCalledWith(true)
  },
}
