import type { Meta, StoryObj } from '@storybook/react-vite'
import { AvatarStack } from './AvatarStack.tsx'
import { crowd, everyone, maya, riley } from '../stories/fixtures.ts'

const meta = {
  title: 'People/AvatarStack',
  component: AvatarStack,
  args: { people: everyone },
} satisfies Meta<typeof AvatarStack>

export default meta
type Story = StoryObj<typeof meta>

export const Few: Story = { args: { people: [riley, maya] } }

export const Some: Story = {}

export const Many: Story = { args: { people: crowd } }

// A team of 2,148, of which the page loaded the first eight
export const LargeTeam: Story = { args: { people: crowd.slice(0, 8), total: 2148 } }

export const Empty: Story = { args: { people: [] } }
