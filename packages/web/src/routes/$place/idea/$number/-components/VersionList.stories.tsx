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

// Reading the latest: each earlier version can be compared with it
export const Latest: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('link', { name: 'Version 4' })).toHaveAttribute('aria-current', 'page')
    await expect(list.getAllByRole('link', { name: 'Compare with v4' })).toHaveLength(3)
    await expect(list.getByText('Edited with 3 commands')).toBeVisible()
    await expect(list.getByText('Edited with 1 command')).toBeVisible()
  },
}

// Comparing v4 against v2: the range between them marked
export const Comparing: Story = { args: { base: 2 } }

// Reading an older version: the latest marked as such, nothing after it to compare
export const Older: Story = {
  args: { viewing: 2 },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByText('latest')).toBeVisible()
    await expect(list.getAllByRole('link', { name: 'Compare with v2' })).toHaveLength(1)
  },
}

// A draft, reading: what the next version will be, at the top, to open
export const WithADraft: Story = {
  args: { draft: { on: 4, changes: 3, by: ['Riley Park', 'Maya Chen'], onOpen: fn() } },
  play: async ({ args, canvasElement, userEvent }) => {
    const list = within(canvasElement)
    await expect(list.getByText('not committed')).toBeVisible()
    await expect(list.getByText('3 changes')).toBeVisible()
    await expect(list.getByText('by Riley Park, Maya Chen')).toBeVisible()
    await userEvent.click(list.getByRole('button', { name: 'Open the draft' }))
    await expect(args.draft!.onOpen).toHaveBeenCalled()
  },
}

// The draft open: its changes listed, and compared with any version from here
export const EditingTheDraft: Story = {
  args: {
    draft: {
      on: 4,
      changes: 2,
      by: ['Riley Park'],
      open: true,
      comparedWith: null,
      onCompare: fn(),
      detail: <p>Edited “Field technicians lose signal underground.” · Riley Park</p>,
    },
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const list = within(canvasElement)
    await expect(list.getByText('editing')).toBeVisible()
    await expect(list.getByText(/Field technicians lose signal/)).toBeVisible()
    // no version's shown while the draft is
    await expect(list.queryByText('viewing')).toBeNull()
    await expect(list.getAllByRole('button', { name: 'Compare with the draft' })).toHaveLength(4)
    await userEvent.click(list.getAllByRole('button', { name: 'Compare with the draft' })[2]!)
    await expect(args.draft!.onCompare).toHaveBeenCalledWith(2)
    await userEvent.click(list.getByRole('button', { name: 'Compare with v4' }))
    await expect(args.draft!.onCompare).toHaveBeenCalledWith(4)
  },
}

// The draft compared with v2: the range marked, and the way back to editing
export const ComparingTheDraft: Story = {
  args: {
    draft: { on: 4, changes: 2, by: ['Riley Park'], open: true, comparedWith: 2, onCompare: fn() },
  },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByText('comparing')).toBeVisible()
    await expect(list.getByText('compared with the draft')).toBeVisible()
    await expect(list.getAllByRole('button', { name: 'Back to editing' })).toHaveLength(2)
  },
}
