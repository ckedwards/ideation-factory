import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
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
  // as the page has them: the actions in the idea's bar (or the focus view's top line), the changes
  // a dialog from there
  render: (args) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      <EditActions {...args} />
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
    const body = within(canvasElement.ownerDocument.body)
    // not beside the page: the count, which opens them
    await expect(body.queryByRole('dialog')).toBeNull()
    await userEvent.click(page.getByRole('button', { name: '3 changes' }))
    const dialog = within(await body.findByRole('dialog', { name: 'The draft’s changes' }))
    await expect(dialog.getAllByRole('img', { name: 'Maya Chen' })[0]).toBeVisible()
    await expect(dialog.getAllByRole('img', { name: 'Priya Natarajan' })[0]).toBeVisible()
    await expect(dialog.getByText('stays, on changed text')).toBeVisible()
    await expect(dialog.getByText('loses its text: outdated')).toBeVisible()
    // comments that stay where they are aren't listed
    await expect(dialog.queryByText('“oldest first”')).toBeNull()
    await userEvent.click(dialog.getAllByRole('button', { name: 'Undo this change' })[1]!)
    await expect(args.onUndo).toHaveBeenCalledWith('k2')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
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
    // nothing to list: no count
    await expect(page.queryByRole('button', { name: /changes?$/ })).toBeNull()
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
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    // the count says so, as Commit waits on it; the list says which, and why
    await expect(page.getByRole('button', { name: 'Commit as v4' })).toBeDisabled()
    await userEvent.click(page.getByRole('button', { name: '2 changes · 1 outdated' }))
    const dialog = within(await body.findByRole('dialog', { name: 'The draft’s changes' }))
    await expect(dialog.getByText(/Outdated: that block has changed/)).toBeVisible()
    await expect(dialog.getByText('A change is outdated: undo or redo it to commit.')).toBeVisible()
  },
}

// Files made, renamed and deleted are changes too: a folder renamed is one row with one Undo, and the
// count says how many files they're in
export const FileChanges: Story = {
  args: {
    changes: [
      { key: 'c-f9', label: 'Added research/costs.md', authors: [riley] },
      { key: 'r-f3', label: 'Renamed research to findings (4 files)', authors: [maya] },
      { key: 'e-b3', label: 'Edited “See the findings.”', authors: [maya] },
      { key: 'x-f6', label: 'Deleted sync-queue.md', authors: [riley] },
    ],
    files: 7,
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: '4 changes in 7 files' }))
    const dialog = within(await body.findByRole('dialog', { name: 'The draft’s changes' }))
    await expect(dialog.getByText('Renamed research to findings (4 files)')).toBeVisible()
    await userEvent.click(dialog.getAllByRole('button', { name: 'Undo this change' })[1]!)
    await expect(args.onUndo).toHaveBeenCalledWith('r-f3')
  },
}
