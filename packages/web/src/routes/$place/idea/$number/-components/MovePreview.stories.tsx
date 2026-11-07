import type { Meta, StoryObj } from '@storybook/react-vite'
import { crowd, devon, maya, sam } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { MovePreview } from './MovePreview.tsx'

const meta = {
  title: 'Ideas/MovePreview',
  component: MovePreview,
  args: {
    from: 'Mobile',
    to: 'Payments',
    losing: { count: 2, people: [maya, devon], everyone: false },
    gaining: { count: 1, people: [sam], everyone: false },
    removed: [{ key: 'team:t1', label: 'Mobile’s members', checked: false }],
    added: [{ key: 'group:g1', label: 'Security reviewers (group)', checked: false }],
    onKeep: fn(),
    onSkip: fn(),
    onConfirm: fn(),
  },
} satisfies Meta<typeof MovePreview>

export default meta
type Story = StoryObj<typeof meta>

// Who loses and gains access, by name, and what can be adjusted
export const Preview: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(within(page.getByRole('region', { name: 'Losing access' })).getByText('Maya Ortiz')).toBeVisible()
    await userEvent.click(page.getByRole('checkbox', { name: /Keep Mobile’s members/ }))
    await expect(args.onKeep).toHaveBeenCalledWith('team:t1', true)
    await userEvent.click(page.getByRole('button', { name: 'Move it to Payments' }))
    await expect(args.onConfirm).toHaveBeenCalled()
  },
}

// Many people: the first few by name, and how many more
export const Many: Story = {
  args: { losing: { count: 40, people: crowd.slice(0, 8), everyone: false } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('and 32 others')).toBeVisible()
  },
}

// Nothing changes for anyone
export const NoChange: Story = {
  args: {
    losing: { count: 0, people: [], everyone: false },
    gaining: { count: 0, people: [], everyone: false },
    removed: [],
    added: [],
  },
}
