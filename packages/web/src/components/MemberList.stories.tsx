import type { Meta, StoryObj } from '@storybook/react-vite'
import { jonas, longName, maya, riley } from '@ideaf/ui/fixtures'
import { expect, within } from 'storybook/test'
import { MemberList } from './MemberList.tsx'

const meta = {
  title: 'App/MemberList',
  component: MemberList,
  args: {
    members: [
      { person: riley, role: 'admin' },
      { person: maya, role: 'maintainer' },
      { person: jonas, role: 'member' },
      { person: longName, role: 'member' },
    ],
  },
} satisfies Meta<typeof MemberList>

export default meta
type Story = StoryObj<typeof meta>

// Roles marked; members plain; each linked to their page
export const Members: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByText('admin')).toBeVisible()
    await expect(list.getByRole('link', { name: /Riley Park/ })).toHaveAttribute('href', '/@riley')
  },
}

export const None: Story = { args: { members: [] } }
