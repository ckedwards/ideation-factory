import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { DocToolbar } from './DocToolbar.tsx'

const meta = {
  title: 'Ideas/DocToolbar',
  component: DocToolbar,
  args: {
    path: 'notes/plan.md',
    version: 3,
    latest: 3,
    compare: null,
    compareWith: [
      { version: 2, href: '/mobile/idea/9/changes/2..?file=notes/plan.md' },
      { version: 1, href: '/mobile/idea/9/changes/1..?file=notes/plan.md' },
    ],
    onCompare: fn(),
    source: false,
    onSource: fn(),
    review: { href: '/mobile/idea/9', pending: 0 },
    edit: { label: 'Edit', disabled: false, onEdit: fn() },
  },
} satisfies Meta<typeof DocToolbar>

export default meta
type Story = StoryObj<typeof meta>

// Which file, and what can be done with it: compare, read the source, review, edit
export const Latest: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const bar = within(canvasElement)
    await expect(bar.getByText('notes/plan.md')).toBeVisible()
    await userEvent.selectOptions(bar.getByRole('combobox', { name: 'Compare with another version' }), 'With v1')
    await expect(args.onCompare).toHaveBeenCalledWith('/mobile/idea/9/changes/1..?file=notes/plan.md')
    await userEvent.click(bar.getByRole('button', { name: 'Source' }))
    await expect(args.onSource).toHaveBeenCalledWith(true)
    await expect(bar.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/mobile/idea/9')
  },
}

// An older version, compared with an earlier one: the version said, a chip to stop comparing
export const ComparingAnOlderVersion: Story = {
  args: { version: 2, compare: { base: 1, stopHref: '/mobile/idea/9/files?v=2' }, review: null, edit: null },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement)
    await expect(bar.getByText('@ v2')).toBeVisible()
    await expect(bar.getByText('Changes v1 → v2')).toBeVisible()
    await expect(bar.queryByRole('combobox', { name: 'Compare with another version' })).toBeNull()
  },
}

// Comments waiting in your review: Review says so, and leads
export const PendingReview: Story = {
  args: { review: { href: '/mobile/idea/9', pending: 2 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'Finish your review (2)' })).toBeVisible()
  },
}
