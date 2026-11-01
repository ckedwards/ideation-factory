import type { Meta, StoryObj } from '@storybook/react-vite'
import { StatusPill } from './StatusPill.tsx'

const meta = {
  title: 'Ideas/StatusPill',
  component: StatusPill,
  args: { status: 'requesting review' },
} satisfies Meta<typeof StatusPill>

export default meta
type Story = StoryObj<typeof meta>

export const Draft: Story = { args: { status: 'draft' } }

export const RequestingReview: Story = {}

export const ChangesInProgress: Story = { args: { status: 'changes in progress' } }

export const Approved: Story = { args: { status: 'approved' } }

export const ClosedAccepted: Story = { args: { status: 'closed', reason: 'accepted' } }

export const ClosedRejected: Story = { args: { status: 'closed', reason: 'rejected' } }

// Its team is archived, so it's read only whatever its status says
export const Archived: Story = { args: { status: 'changes in progress', archived: true } }

export const Every: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      <StatusPill status="draft" />
      <StatusPill status="requesting review" />
      <StatusPill status="changes in progress" />
      <StatusPill status="approved" />
      <StatusPill status="closed" reason="accepted" />
      <StatusPill status="closed" reason="rejected" />
      <StatusPill status="requesting review" archived />
    </div>
  ),
}
