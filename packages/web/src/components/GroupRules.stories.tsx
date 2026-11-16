import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { GroupRules } from './GroupRules.tsx'

const security = { id: 'g1', handle: 'security', name: 'Security' }
const legal = { id: 'g2', handle: 'legal', name: 'Legal' }

const meta = {
  title: 'Groups/GroupRules',
  component: GroupRules,
  args: {
    group: security,
    rules: [
      { team: { id: 't1', handle: 'platform', name: 'Platform' }, mode: 'any', request: true, groups: [security] },
      {
        team: { id: 't2', handle: 'payments', name: 'Payments' },
        mode: 'each',
        request: false,
        groups: [security, legal],
      },
    ],
  },
} satisfies Meta<typeof GroupRules>

export default meta
type Story = StoryObj<typeof meta>

// Each team rule that names the group, as a sentence
export const Used: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('link', { name: 'Platform' })).toHaveAttribute('href', '/platform')
    await expect(list.getAllByRole('listitem')[1]).toHaveTextContent(
      'Payments: closing an idea as accepted needs an approval from each of Security and Legal',
    )
    await expect(list.getByText(/asked to review when an idea goes out/)).toBeVisible()
  },
}

export const Unused: Story = {
  args: { rules: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No team’s approval requirements name Security.')).toBeVisible()
  },
}
