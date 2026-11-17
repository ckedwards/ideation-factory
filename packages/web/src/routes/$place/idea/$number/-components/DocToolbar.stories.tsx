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
    // only the file's own controls: your review is of the idea, in its bar
    await expect(bar.queryByRole('button', { name: /review/i })).toBeNull()
    // the toolbar's buttons are the medium size: big enough for a finger
    await expect(bar.getByRole('button', { name: 'Edit' }).getBoundingClientRect().height).toBeGreaterThanOrEqual(28)
  },
}

// Comparing: one control says which versions, changes either, and stops
export const Comparing: Story = {
  args: {
    version: 3,
    compare: { base: 1, stopHref: '/mobile/idea/9/files' },
    edit: null,
    range: { versions: [3, 2, 1], onRange: fn() },
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const bar = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await expect(bar.queryByRole('combobox', { name: 'Compare with another version' })).toBeNull()
    await userEvent.click(bar.getByRole('button', { name: 'Comparing: v1 → v3' }))
    await userEvent.selectOptions(await body.findByRole('combobox', { name: 'Compared with' }), '2')
    await expect(args.range!.onRange).toHaveBeenCalledWith(3, 2)
    await userEvent.click(bar.getByRole('button', { name: 'Comparing: v1 → v3' }))
    await userEvent.click(await body.findByRole('button', { name: 'Stop comparing' }))
    await expect(args.onCompare).toHaveBeenCalledWith('/mobile/idea/9/files')
  },
}

// An older version, compared with an earlier one: the version said
export const ComparingAnOlderVersion: Story = {
  args: { version: 2, compare: { base: 1, stopHref: '/mobile/idea/9/files?v=2' }, edit: null },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement)
    await expect(bar.getByText('@ v2')).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Comparing: v1 → v2' })).toBeVisible()
  },
}

// The editor's open: the bar stays, as tall as before so the document doesn't move, and says so
export const Editing: Story = {
  args: { editing: true },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement)
    await expect(bar.getByText(/Hover a block to edit it/)).toBeVisible()
    await expect(bar.queryByRole('button', { name: 'Source' })).toBeNull()
    await expect(
      canvasElement.querySelector('.doc-toolbar-actions')!.getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(28)
  },
}
