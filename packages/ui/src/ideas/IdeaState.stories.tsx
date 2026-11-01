import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { IdeaState } from './IdeaState.tsx'
import { ideas } from '../stories/fixtures.ts'

const meta = {
  title: 'Ideas/IdeaState',
  component: IdeaState,
  args: { idea: ideas.inReview },
  decorators: [
    (Story) => (
      <div style={{ padding: '17rem 1rem 1rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IdeaState>

export default meta
type Story = StoryObj<typeof meta>

export const InReview: Story = {}

export const RequirementsMet: Story = { args: { idea: ideas.requirementsMet } }

export const NoRequirements: Story = { args: { idea: ideas.noRequirements } }

export const Draft: Story = { args: { idea: ideas.draft } }

export const ClosedAccepted: Story = { args: { idea: ideas.accepted } }

export const ClosedRejected: Story = { args: { idea: ideas.rejected } }

export const Archived: Story = { args: { idea: ideas.archived } }

export const Compact: Story = { args: { compact: true } }

export const Every: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
      {[ideas.draft, ideas.inReview, ideas.requirementsMet, ideas.accepted, ideas.rejected, ideas.archived].map(
        (idea) => (
          <IdeaState key={idea.id} idea={idea} />
        ),
      )}
    </div>
  ),
}

// Focus opens the details at once
export const Details: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab()
    const tip = await within(canvasElement.ownerDocument.body).findByRole('tooltip')
    await expect(tip).toHaveTextContent('In review · 1 of 2 requirements met')
    await expect(tip).toHaveTextContent('5h ago · v3')
  },
}
