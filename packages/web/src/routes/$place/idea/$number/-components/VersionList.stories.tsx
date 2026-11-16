import type { Meta, StoryObj } from '@storybook/react-vite'
import { actors, NOW } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { VersionList } from './VersionList.tsx'

const hours = (n: number) => NOW - n * 3_600_000

const meta = {
  title: 'Ideas/VersionList',
  component: VersionList,
  args: {
    versions: [
      { number: 4, by: actors.person, at: hours(1), how: 'upload', steps: 0 },
      { number: 3, by: actors.botForPerson, at: hours(5), how: 'commands', steps: 3 },
      { number: 2, by: actors.bot, at: hours(30), how: 'commands', steps: 1 },
      { number: 1, by: actors.person, at: hours(72), how: 'created', steps: 0 },
    ],
    viewing: 4,
    latest: 4,
    base: null,
    viewHref: (n) => `#v${n}`,
    compareHref: (n) => `#compare-${n}`,
  },
} satisfies Meta<typeof VersionList>

export default meta
type Story = StoryObj<typeof meta>

// Reading the latest: each earlier version offers its changes since
export const Latest: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('link', { name: 'v4' })).toHaveAttribute('aria-current', 'page')
    await expect(list.getAllByRole('link', { name: 'Changes since' })).toHaveLength(3)
    await expect(list.getByText('Edited with 3 commands')).toBeVisible()
    await expect(list.getByText('Edited with 1 command')).toBeVisible()
  },
}

// Comparing v4 against v2: the range between them marked
export const Comparing: Story = { args: { base: 2 } }

// The pickers above the list: which version is shown, and what it's compared with
export const Pickers: Story = {
  args: { base: 2, onRange: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('combobox', { name: 'Compared with' })).toHaveValue('2')
    await userEvent.selectOptions(list.getByRole('combobox', { name: 'Compared with' }), '1')
    await expect(args.onRange).toHaveBeenCalledWith(args.viewing, 1)
    await userEvent.selectOptions(list.getByRole('combobox', { name: 'Compared with' }), 'nothing')
    await expect(args.onRange).toHaveBeenCalledWith(args.viewing, null)
  },
}

// Reading an older version: the latest marked as such, nothing after it to compare
export const Older: Story = {
  args: { viewing: 2 },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByText('latest')).toBeVisible()
    await expect(list.getAllByRole('link', { name: 'Changes since' })).toHaveLength(1)
  },
}
