import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { ApprovalProgress } from './ApprovalProgress.tsx'
import { requirements } from '../stories/fixtures.ts'

const meta = {
  title: 'Ideas/ApprovalProgress',
  component: ApprovalProgress,
  args: { approvals: 1, requirements: requirements.oneOfTwo, teamName: 'Mobile' },
  decorators: [
    (Story) => (
      <div style={{ padding: '7rem 1rem 1rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ApprovalProgress>

export default meta
type Story = StoryObj<typeof meta>

export const PartlyMet: Story = {}

export const AllMet: Story = { args: { approvals: 2, requirements: requirements.allMet } }

// A rule names a deleted group, so a maintainer has to fix it
export const NeedsFixing: Story = { args: { requirements: requirements.broken } }

export const NoRequirements: Story = { args: { approvals: 3, requirements: requirements.none } }

// Focus shows each requirement and where it stands
export const KeyboardFocus: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab()
    const tip = await within(canvasElement.ownerDocument.body).findByRole('tooltip')
    await expect(tip).toHaveTextContent('All discussions resolved (2 open)')
  },
}
