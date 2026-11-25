import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { EditActions, EditPanel, type Together } from './EditPanel.tsx'

const riley = { id: 'u-riley', name: 'Riley Park' }
const maya = { id: 'u-maya', name: 'Maya Chen' }
const priya = { id: 'u-priya', name: 'Priya Natarajan' }
const agent = { id: 'u-tomas/Agent', name: 'Agent for Tomás' }

const changes = [
  { key: 'k1', label: 'Edited “Field technicians lose signal underground.”', authors: [riley] },
  { key: 'k2', label: 'Added “Conflicts go to the newest change.”', authors: [maya, priya] },
  { key: 'k3', label: 'Suggestion c4: “oldest first” → “in order”', authors: [riley] },
]

// Riley commits, with Maya, Priya and an agent's changes in the draft too
const together: Together = {
  changes: 3,
  files: 2,
  people: [
    { key: 'priya', person: priya, changes: 1, typingIn: 'Why', you: false },
    { key: 'maya', person: maya, changes: 1, typingIn: null, you: false },
    { key: 'agent', person: agent, changes: 1, typingIn: null, you: false },
    { key: 'riley', person: riley, changes: 2, typingIn: null, you: true },
  ],
}

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

// The draft's changes, the faces of who typed in each, and what committing does to comments. With
// nobody else in the draft, committing goes ahead at once.
export const Changes: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('3 changes')).toBeVisible()
    await expect(page.getAllByRole('img', { name: 'Maya Chen' })[0]).toBeVisible()
    await expect(page.getAllByRole('img', { name: 'Priya Natarajan' })[0]).toBeVisible()
    await expect(page.getByText('stays, on changed text')).toBeVisible()
    await expect(page.getByText('loses its text: outdated')).toBeVisible()
    // comments that stay where they are aren't listed
    await expect(page.queryByText('“oldest first”')).toBeNull()
    await userEvent.click(page.getAllByRole('button', { name: 'Undo this change' })[1]!)
    await expect(args.onUndo).toHaveBeenCalledWith('k2')
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    await expect(args.onCommit).toHaveBeenCalled()
  },
}

// With others in the draft, committing names who it takes from first, and who's typing now
export const CommittingTogether: Story = {
  args: { together },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    await expect(args.onCommit).not.toHaveBeenCalled()
    await expect(body.getByText('This takes the whole draft as it is now: 3 changes in 2 files.')).toBeVisible()
    await expect(body.getByText('· typing in “Why” now')).toBeVisible()
    await expect(body.getByText('You')).toBeVisible()
    await expect(
      body.getByText('Anything typed after you commit stays in the draft for the next version.'),
    ).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }))
    await expect(args.onCommit).not.toHaveBeenCalled()
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    await userEvent.click(body.getByRole('button', { name: 'Commit for everyone' }))
    await expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

// Discarding is everyone's draft: it asks first, naming whose changes go
export const Discarding: Story = {
  args: { together },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Discard' }))
    await expect(
      body.getByText(
        'Every change in the draft goes, for everyone who can edit it: 3 changes, by Priya Natarajan, Maya Chen, Agent for Tomás and you.',
      ),
    ).toBeVisible()
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

// Typed on the page, not saved yet: Commit is there at once, and saves it first
export const Unsaved: Story = {
  args: { changes: [], outcomes: [], unsaved: true },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('button', { name: 'Preview' })).toBeEnabled()
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    await expect(args.onCommit).toHaveBeenCalled()
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
