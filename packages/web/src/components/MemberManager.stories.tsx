import type { Meta, StoryObj } from '@storybook/react-vite'
import { jonas, maya, riley, sam } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { MemberManager } from './MemberManager.tsx'

const meta = {
  title: 'App/MemberManager',
  component: MemberManager,
  args: {
    members: [
      { person: riley, role: 'admin' },
      { person: maya, role: 'maintainer' },
      { person: sam, role: 'member' },
      { person: jonas, role: 'member' },
    ],
    you: { id: riley.id, role: 'admin' },
    onRole: fn(),
    onRemove: fn(),
    onAdd: fn(),
  },
} satisfies Meta<typeof MemberManager>

export default meta
type Story = StoryObj<typeof meta>

// An admin: changes anyone's role, removes anyone, leaves
export const Admin: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Sam Achebe’s role' }), 'maintainer')
    await expect(args.onRole).toHaveBeenCalledWith(sam, 'maintainer')
    await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible()
    await expect(page.getAllByRole('button', { name: 'Remove' })).toHaveLength(3)
  },
}

// A maintainer: sees roles, removes only members, can't give roles
export const Maintainer: Story = {
  args: { you: { id: maya.id, role: 'maintainer' } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.queryByRole('combobox', { name: /role/ })).toBeNull()
    await expect(page.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    await expect(page.queryByRole('combobox', { name: 'As' })).toBeNull()
  },
}
