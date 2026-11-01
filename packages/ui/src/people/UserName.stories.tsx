import type { Meta, StoryObj } from '@storybook/react-vite'
import { UserName } from './UserName.tsx'
import { jonas, longName, riley } from '../stories/fixtures.ts'

const meta = {
  title: 'People/UserName',
  component: UserName,
  args: { person: riley },
} satisfies Meta<typeof UserName>

export default meta
type Story = StoryObj<typeof meta>

export const Name: Story = {}

export const WithAvatar: Story = { args: { withAvatar: true } }

export const Inactive: Story = { args: { person: jonas, withAvatar: true } }

// Long names shorten with an ellipsis when their container is narrow
export const LongName: Story = {
  args: { person: longName, withAvatar: true },
  render: (args) => (
    <div style={{ width: '16rem', display: 'flex' }}>
      <UserName {...args} />
    </div>
  ),
}
