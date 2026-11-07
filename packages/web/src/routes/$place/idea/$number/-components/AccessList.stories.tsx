import type { Meta, StoryObj } from '@storybook/react-vite'
import { riley } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { AccessList } from './AccessList.tsx'
import { ShareAdder } from './ShareAdder.tsx'

const meta = {
  title: 'Ideas/AccessList',
  component: AccessList,
  args: {
    owner: riley,
    grants: [
      { key: 'team:t1', label: 'Mobile’s members', href: '/mobile', everyone: false, edit: false, share: false },
      { key: 'user:u-maya', label: 'Maya Ortiz (@maya)', href: '/@maya', everyone: false, edit: true, share: false },
      {
        key: 'group:g1',
        label: 'Security reviewers (group)',
        href: '/groups/security',
        everyone: false,
        edit: false,
        share: true,
      },
      { key: 'everyone', label: 'Everyone on the site', everyone: true, edit: false, share: false },
    ],
    canShare: true,
    onLevel: fn(),
    onRemove: fn(),
    adder: <ShareAdder onShare={() => {}} />,
  },
} satisfies Meta<typeof AccessList>

export default meta
type Story = StoryObj<typeof meta>

// Someone who can share: changes, removes and adds; everyone on the site can only view
export const CanShare: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'What Maya Ortiz (@maya) can do' }), 'all')
    await expect(args.onLevel).toHaveBeenCalledWith(expect.objectContaining({ key: 'user:u-maya' }), 'all')
    await expect(page.queryByRole('combobox', { name: 'What Everyone on the site can do' })).toBeNull()
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible()
  },
}

// Someone who can only look
export const ReadOnly: Story = {
  args: { canShare: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Remove' })).toBeNull()
  },
}

// Shared with nobody yet
export const Private: Story = { args: { grants: [] } }
