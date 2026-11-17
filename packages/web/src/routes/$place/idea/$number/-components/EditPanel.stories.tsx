import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { EditActions, EditPanel } from './EditPanel.tsx'

const changes = [
  { key: 'k1', label: 'Edited “Field technicians lose signal underground.”', by: 'Riley Park' },
  { key: 'k2', label: 'Added “Conflicts go to the newest change.”', by: 'Maya Chen' },
  { key: 'k3', label: 'Suggestion c4: “oldest first” → “in order”', by: 'Riley Park' },
]

const meta = {
  title: 'Ideas/EditPanel',
  component: EditPanel,
  // as the page has them: the actions in the idea's bar, the panel beside the document
  render: (args) => (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '24rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <EditActions {...args} />
      </div>
      <EditPanel {...args} />
    </div>
  ),
  args: {
    version: 3,
    changes,
    outcomes: [
      { id: 'c1', label: '“plant rooms”', state: 'changed' },
      { id: 'c2', label: '“oldest first”', state: 'exact' },
      { id: 'c3', label: '“Rollout”', state: 'outdated' },
    ],
    previewing: false,
    committing: false,
    onUndo: fn(),
    onPreview: fn(),
    onCommit: fn(),
    onDiscard: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof EditPanel>

export default meta
type Story = StoryObj<typeof meta>

// The draft's changes, who made each, and what committing does to comments
export const Changes: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('3 changes')).toBeVisible()
    await expect(page.getByText('stays, on changed text')).toBeVisible()
    await expect(page.getByText('loses its text: outdated')).toBeVisible()
    // comments that stay where they are aren't listed
    await expect(page.queryByText('“oldest first”')).toBeNull()
    await userEvent.click(page.getAllByRole('button', { name: 'Undo' })[1]!)
    await expect(args.onUndo).toHaveBeenCalledWith('k2')
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    await expect(args.onCommit).toHaveBeenCalled()
  },
}

// Discarding is everyone's draft: it asks first
export const Discarding: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Discard' }))
    await expect(body.getByText(/Every change in the draft goes, for everyone who can edit it/)).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Discard the draft' }))
    await expect(args.onDiscard).toHaveBeenCalled()
  },
}

// An empty draft
export const Empty: Story = {
  args: { changes: [], outcomes: [] },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('No changes yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Commit as v4' })).toBeDisabled()
  },
}

// A version made elsewhere changed a block the draft had changed: committing waits
export const Outdated: Story = {
  args: {
    changes: [changes[0]!, { ...changes[1]!, problem: 'that block has changed since; undo this, and edit it again' }],
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText(/Outdated: that block has changed/)).toBeVisible()
    await expect(page.getByText('A change is outdated: undo or redo it to commit.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Commit as v4' })).toBeDisabled()
  },
}
