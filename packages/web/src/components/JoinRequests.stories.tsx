import type { Meta, StoryObj } from '@storybook/react-vite'
import { maya, sam } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { JoinRequests } from './JoinRequests.tsx'

const meta = {
  title: 'App/JoinRequests',
  component: JoinRequests,
  args: { people: [maya, sam], onDecide: fn() },
} satisfies Meta<typeof JoinRequests>

export default meta
type Story = StoryObj<typeof meta>

export const Asking: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getAllByRole('button', { name: 'Let in' })[0]!)
    await expect(args.onDecide).toHaveBeenCalledWith(maya, true)
  },
}

export const Nobody: Story = { args: { people: [] } }
