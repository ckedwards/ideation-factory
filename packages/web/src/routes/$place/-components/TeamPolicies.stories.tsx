import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { TeamPolicies } from './TeamPolicies.tsx'

const meta = {
  title: 'Teams/TeamPolicies',
  component: TeamPolicies,
  args: {
    createPolicy: 'members',
    defaults: {
      members: 'view',
      public: false,
      groups: [{ group: { id: 'g1', handle: 'security', name: 'Security reviewers' }, edit: false }],
    },
    onCreatePolicy: fn(),
    onDefaults: fn(),
  },
} satisfies Meta<typeof TeamPolicies>

export default meta
type Story = StoryObj<typeof meta>

// Each change is saved as it's made
export const Policies: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Who can start an idea in it' }), 'maintainers')
    await expect(args.onCreatePolicy).toHaveBeenCalledWith('maintainers')
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Everyone on the site' }), 'yes')
    await expect(args.onDefaults).toHaveBeenCalledWith(expect.objectContaining({ public: true }))
    await userEvent.click(page.getByRole('button', { name: 'Remove' }))
    await expect(args.onDefaults).toHaveBeenLastCalledWith(expect.objectContaining({ groups: [] }))
  },
}
