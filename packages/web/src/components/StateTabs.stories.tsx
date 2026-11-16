import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { StateTabs } from './StateTabs.tsx'

const meta = {
  title: 'Lists/StateTabs',
  component: StateTabs,
  args: {
    value: 'open',
    onChange: fn(),
    counts: { open: 12, closed: 40 },
    children: <p>The open ideas.</p>,
  },
} satisfies Meta<typeof StateTabs>

export default meta
type Story = StoryObj<typeof meta>

// Tabs, each with how many it has; choosing one says so
export const WithCounts: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const tabs = within(canvasElement)
    await expect(tabs.getByRole('tab', { name: 'Open 12' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(tabs.getByRole('tab', { name: 'Closed 40' }))
    await expect(args.onChange).toHaveBeenCalledWith('closed')
  },
}

// Before the counts come, the tabs are there without them
export const Counting: Story = {
  args: { counts: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('tab', { name: 'Open' })).toBeVisible()
  },
}
