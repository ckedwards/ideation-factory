import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { IdeaRow } from './IdeaRow.tsx'
import { Tag } from '../labels/Tag.tsx'
import { ideas } from '../stories/fixtures.ts'

const meta = {
  title: 'Ideas/IdeaRow',
  component: IdeaRow,
  args: { idea: ideas.inReview },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '52rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IdeaRow>

export default meta
type Story = StoryObj<typeof meta>

export const InReview: Story = {}

export const RequirementsMet: Story = { args: { idea: ideas.requirementsMet } }

export const RequirementsNeedFixing: Story = { args: { idea: ideas.brokenRequirements } }

export const NoRequirements: Story = { args: { idea: ideas.noRequirements } }

export const Draft: Story = { args: { idea: ideas.draft } }

export const Private: Story = {
  args: { idea: ideas.private },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Private')).toBeVisible()
  },
}

// someone's own idea, shared with others (or everyone): not private, so no tag says it is
export const SharedOwnIdea: Story = {
  args: { idea: { ...ideas.private, visibility: 'shared' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('Private')).toBeNull()
  },
}

export const LockedTeam: Story = { args: { idea: ideas.locked } }

export const ClosedAccepted: Story = { args: { idea: ideas.accepted } }

export const ClosedRejected: Story = { args: { idea: ideas.rejected } }

export const TeamArchived: Story = { args: { idea: ideas.archived } }

export const InactiveAuthor: Story = { args: { idea: ideas.inactiveAuthor } }

export const LongText: Story = { args: { idea: ideas.long } }

export const SearchMatch: Story = { args: { query: 'sync' } }

// On the team's page, the team goes without saying
export const OnTeamPage: Story = { args: { hide: { team: true } } }

export const WithExtra: Story = { args: { extra: <Tag tone="warn">Waiting on you</Tag> } }

// In a narrow column, the side facts move under the rest
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '24rem' }}>
        <Story />
      </div>
    ),
  ],
}

export const List: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {[ideas.inReview, ideas.requirementsMet, ideas.draft, ideas.accepted, ideas.archived].map((idea) => (
        <IdeaRow key={idea.id} idea={idea} />
      ))}
    </div>
  ),
}
