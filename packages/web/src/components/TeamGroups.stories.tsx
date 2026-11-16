import type { Meta, StoryObj } from '@storybook/react-vite'
import { riley } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { TeamGroups } from './TeamGroups.tsx'

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime()
const design = { id: 'g-design', handle: 'design', name: 'Design reviewers', members: 12 }
const security = { id: 'g-sec', handle: 'security', name: 'Security', members: 4 }

const meta = {
  title: 'App/TeamGroups',
  component: TeamGroups,
  args: {
    team: { handle: 'mobile', name: 'Mobile' },
    groups: [
      {
        group: design,
        role: 'maintainer',
        addedBy: { id: riley.id, handle: 'riley', name: riley.name },
        added: day('2026-10-02'),
        leaving: 9,
      },
      { group: security, role: 'member', addedBy: null, added: day('2026-11-01'), leaving: 0 },
    ],
    admin: true,
    onAdd: fn(),
    onRole: fn(),
    onRemove: fn(),
  },
} satisfies Meta<typeof TeamGroups>

export default meta
type Story = StoryObj<typeof meta>

// the team's admins change a group's role, and take it out after seeing who'd leave
export const Admin: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Security’s role' }), 'maintainer')
    await expect(args.onRole).toHaveBeenCalledWith(security, 'maintainer')
    await userEvent.click(page.getByRole('button', { name: 'Remove Design reviewers' }))
    const body = within(canvasElement.ownerDocument.body)
    const dialog = body.getByRole('dialog', { name: 'Take Design reviewers out of Mobile?' })
    await expect(
      within(dialog).getByText(/9 people in Mobile only through Design reviewers will leave it/),
    ).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Take it out' }))
    await expect(args.onRemove).toHaveBeenCalledWith(design)
  },
}

// a maintainer sees the groups, but only the team's admins change them
export const Maintainer: Story = {
  args: { admin: false },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(within(page.getByRole('table', { name: 'Groups' })).getByText('Maintainers')).toBeVisible()
    await expect(page.queryByRole('combobox')).toBeNull()
    await expect(page.queryByRole('button', { name: /Remove|Add a group/ })).toBeNull()
  },
}

export const Adding: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('button', { name: 'Add a group' }))
    const dialog = body.getByRole('dialog', { name: 'Add a group' })
    await expect(within(dialog).getByRole('combobox', { name: 'Its members are' })).toBeVisible()
    await expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()
  },
}

export const None: Story = {
  args: { groups: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No groups are part of Mobile.')).toBeVisible()
  },
}
