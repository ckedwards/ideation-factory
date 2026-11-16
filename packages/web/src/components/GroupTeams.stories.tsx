import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { GroupTeams } from './GroupTeams.tsx'

const mobile = { id: 't-mobile', handle: 'mobile', name: 'Mobile' }
const web = { id: 't-web', handle: 'web', name: 'Web' }

const meta = {
  title: 'App/GroupTeams',
  component: GroupTeams,
  args: {
    group: { name: 'Design reviewers' },
    teams: [
      { team: mobile, role: 'maintainer', added: 0, leaving: 9 },
      { team: web, role: 'member', added: 0, leaving: 0 },
    ],
    admin: true,
    onLeave: fn(),
  },
} satisfies Meta<typeof GroupTeams>

export default meta
type Story = StoryObj<typeof meta>

// the group's admins take it out of a team, after seeing who'd leave the team with it
export const Admin: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText(/its members are maintainers/)).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Leave team Mobile' }))
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', {
      name: 'Take Design reviewers out of Mobile?',
    })
    await expect(within(dialog).getByText(/9 people in Mobile only through Design reviewers/)).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave team' }))
    await expect(args.onLeave).toHaveBeenCalledWith(mobile)
  },
}

export const Member: Story = {
  args: { admin: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: /Leave/ })).toBeNull()
  },
}

export const NoTeams: Story = {
  args: { teams: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Design reviewers isn’t part of any team.')).toBeVisible()
  },
}
