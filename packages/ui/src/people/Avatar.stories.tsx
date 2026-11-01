import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from './Avatar.tsx'
import { crowd, everyone, jonas, longName, riley, withPicture } from '../stories/fixtures.ts'

const meta = {
  title: 'People/Avatar',
  component: Avatar,
  args: { person: riley, size: 'md' },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const Initials: Story = {}

export const Picture: Story = { args: { person: withPicture } }

export const Inactive: Story = { args: { person: jonas } }

export const LongName: Story = { args: { person: longName } }

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
      <Avatar {...args} size="sm" />
      <Avatar {...args} size="md" />
      <Avatar {...args} size="lg" />
      <Avatar {...args} size="xl" />
    </div>
  ),
}

// Each person gets one of eight colors, from their ID
export const Colors: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {[...everyone, ...crowd.slice(0, 16)].map((person) => (
        <Avatar key={person.id} person={person} size="lg" />
      ))}
    </div>
  ),
}
