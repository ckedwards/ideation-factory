import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReviewerStack } from './ReviewerStack.tsx'
import { ideas, offlineSync } from '../stories/fixtures.ts'

const meta = {
  title: 'Ideas/ReviewerStack',
  component: ReviewerStack,
  args: { reviewers: offlineSync.reviewers },
} satisfies Meta<typeof ReviewerStack>

export default meta
type Story = StoryObj<typeof meta>

export const PeopleAndGroup: Story = {}

export const None: Story = { args: { reviewers: [] } }

export const ManyWithDeletedGroup: Story = { args: { reviewers: ideas.long.reviewers } }
