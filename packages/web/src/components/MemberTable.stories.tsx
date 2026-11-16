import type { Meta, StoryObj } from '@storybook/react-vite'
import { jonas, maya, riley, sam } from '@ideaf/ui/fixtures'
import { expect, fn, waitFor, within } from 'storybook/test'
import { MemberTable } from './MemberTable.tsx'

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime()

const meta = {
  title: 'App/MemberTable',
  component: MemberTable,
  args: {
    members: [
      { person: riley, role: 'admin', joined: day('2026-09-19') },
      { person: maya, role: 'maintainer', joined: day('2026-08-12') },
      { person: sam, role: 'member', joined: day('2026-08-05') },
      { person: jonas, role: 'member', joined: day('2026-08-05') },
    ],
    you: { id: riley.id, role: 'admin' },
    view: {},
    onView: fn(),
    onRole: fn(),
    onRemove: fn(),
    onAdd: fn(),
  },
} satisfies Meta<typeof MemberTable>

export default meta
type Story = StoryObj<typeof meta>

// An admin: you marked, when each joined, anyone's role changed, anyone removed, and leaving
export const Admin: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const yours = page.getByRole('row', { name: /Riley/ })
    await expect(within(yours).getByText('It’s you')).toBeVisible()
    await expect(within(yours).getByText('Sep 19, 2026')).toBeVisible()
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Sam Achebe’s role' }), 'maintainer')
    await expect(args.onRole).toHaveBeenCalledWith(sam, 'maintainer')
    await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible()
    await expect(page.getAllByRole('button', { name: /^Remove / })).toHaveLength(3)
    await userEvent.click(page.getByRole('button', { name: 'Remove Sam Achebe' }))
    await expect(args.onRemove).toHaveBeenCalledWith(sam)
  },
}

// A maintainer: sees roles, removes only members, can't give roles
export const Maintainer: Story = {
  args: { you: { id: maya.id, role: 'maintainer' } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.queryByRole('combobox', { name: /’s role/ })).toBeNull()
    await expect(page.getAllByRole('button', { name: /^Remove / })).toHaveLength(2)
    await expect(within(page.getByRole('row', { name: /Maya/ })).getByText('It’s you')).toBeVisible()
  },
}

// the search goes out once typing pauses
export const Filtering: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.type(page.getByRole('searchbox', { name: 'Filter members' }), 'ma')
    await waitFor(() => expect(args.onView).toHaveBeenCalledWith({ q: 'ma' }))
    await expect(args.onView).toHaveBeenCalledTimes(1)
  },
}

// by name, role or when they joined, either way
export const Sorting: Story = {
  args: { view: { sort: 'role' } },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Sort by' }), 'joined')
    await expect(args.onView).toHaveBeenCalledWith({ sort: 'joined' })
    await userEvent.click(page.getByRole('button', { name: 'Ascending: reverse it' }))
    await expect(args.onView).toHaveBeenCalledWith({ sort: 'role', order: 'desc' })
  },
}

// adding someone is a dialog
export const Adding: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('button', { name: 'Add someone' }))
    await expect(body.getByRole('dialog', { name: 'Add someone' })).toBeVisible()
    await expect(body.getByRole('combobox', { name: 'As' })).toBeVisible()
    await expect(body.getByRole('button', { name: 'Add' })).toBeDisabled()
  },
}

export const NoMatch: Story = {
  args: { members: [], view: { q: 'zed' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No member matches “zed”.')).toBeVisible()
  },
}

// in a team through groups: where each comes from; someone in only through a group follows the
// group, so their role can't be changed here and they can't be removed
export const ThroughGroups: Story = {
  args: {
    members: [
      { person: riley, role: 'admin', direct: 'admin', through: [], joined: day('2026-09-19') },
      {
        person: maya,
        role: 'maintainer',
        direct: 'member',
        through: [{ group: { id: 'g-design', handle: 'design', name: 'Design' }, role: 'maintainer' }],
        joined: day('2026-08-12'),
      },
      {
        person: sam,
        role: 'member',
        direct: null,
        through: [{ group: { id: 'g-design', handle: 'design', name: 'Design' }, role: 'member' }],
        joined: day('2026-08-05'),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('columnheader', { name: 'Source' })).toBeVisible()
    const sam_ = page.getByRole('row', { name: /Sam/ })
    await expect(within(sam_).getByText(/Through/)).toBeVisible()
    await expect(within(sam_).queryByRole('combobox')).toBeNull()
    await expect(within(sam_).queryByRole('button')).toBeNull()
    const maya_ = page.getByRole('row', { name: /Maya/ })
    await expect(within(maya_).getByText('Direct')).toBeVisible()
    await expect(within(maya_).getByRole('combobox', { name: /role/ })).toHaveValue('member')
    await expect(within(maya_).getByText(/Maintainer through a group/)).toBeVisible()
  },
}
