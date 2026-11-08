import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { TeamRequirements } from './TeamRequirements.tsx'

const security = { id: 'g1', handle: 'security', name: 'Security' }
const legal = { id: 'g2', handle: 'legal', name: 'Legal' }

const meta = {
  title: 'Teams/TeamRequirements',
  component: TeamRequirements,
  args: {
    requirements: {
      approvals: 2,
      groups: [{ mode: 'each', groups: [security, legal], request: true }],
      resolved: false,
    },
    onChange: fn(),
  },
} satisfies Meta<typeof TeamRequirements>

export default meta
type Story = StoryObj<typeof meta>

// Each change is saved as it's made
export const Requirements: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.selectOptions(
      page.getByRole('combobox', { name: 'Approvals from people, on the latest version' }),
      '3',
    )
    await expect(args.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ approvals: 3 }))
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Needs' }), 'any')
    await expect(args.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ groups: [expect.objectContaining({ mode: 'any' })] }),
    )
    await userEvent.click(page.getByRole('checkbox', { name: 'Every discussion has to be resolved' }))
    await expect(args.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ resolved: true }))
    // taking a group out of a rule keeps the rest
    await userEvent.click(page.getByRole('button', { name: 'Remove Legal from rule 1' }))
    await expect(args.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ groups: [expect.objectContaining({ groups: [security] })] }),
    )
  },
}

// Taking the last group out of a rule removes the rule
export const LastGroup: Story = {
  args: {
    requirements: { approvals: 0, groups: [{ mode: 'any', groups: [security], request: false }], resolved: true },
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Remove Security from rule 1' }))
    await expect(args.onChange).toHaveBeenLastCalledWith({ approvals: 0, groups: [], resolved: true })
  },
}

// None yet
export const Empty: Story = {
  args: { requirements: { approvals: 0, groups: [], resolved: false } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('combobox', { name: 'Approvals from people, on the latest version' })).toHaveValue('0')
    await expect(page.getByRole('button', { name: 'Add a rule' })).toBeDisabled()
  },
}
