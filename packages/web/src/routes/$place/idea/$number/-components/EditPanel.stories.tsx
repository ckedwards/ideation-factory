import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
import type { CommitRow } from './commit-files.ts'
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

// the files a commit takes, as commitRows gives them: a file moved, a folder renamed with a new and an
// edited file in it, one deleted, one edited
const row = (r: Partial<CommitRow> & Pick<CommitRow, 'path' | 'name'>): CommitRow => ({
  kind: 'file',
  depth: 0,
  was: null,
  file: null,
  state: null,
  note: null,
  ...r,
})
const commitFiles: CommitRow[] = [
  row({ kind: 'folder', path: 'decisions', name: 'decisions' }),
  row({
    path: 'decisions/sync-states.md',
    name: 'sync-states.md',
    depth: 1,
    file: 'f5',
    was: 'notes/sync-states.md',
    note: 'Moved',
  }),
  row({ kind: 'folder', path: 'findings', name: 'findings', was: 'research', note: 'Renamed · 3 files' }),
  row({ path: 'findings/costs.md', name: 'costs.md', depth: 1, file: 'f4', state: 'new', note: 'New' }),
  row({
    path: 'findings/interviews.md',
    name: 'interviews.md',
    depth: 1,
    file: 'f2',
    state: 'changed',
    note: 'Edited',
  }),
  row({ kind: 'folder', path: 'notes', name: 'notes' }),
  row({ path: 'notes/standup.md', name: 'standup.md', depth: 1, file: 'f7', state: 'deleted', note: 'Deleted' }),
  row({ path: 'offline.md', name: 'offline.md', file: 'f1', state: 'changed', note: 'Edited' }),
]
// a big draft: 30 more files edited, so the list scrolls
const manyFiles: CommitRow[] = [
  ...commitFiles,
  row({ kind: 'folder', path: 'weekly', name: 'weekly' }),
  ...Array.from({ length: 30 }, (_, i) =>
    row({
      path: `weekly/week-${i + 1}.md`,
      name: `week-${i + 1}.md`,
      depth: 1,
      file: `w${i}`,
      state: 'changed',
      note: 'Edited',
    }),
  ),
]

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
    onCompareFile: fn(),
    onDiscard: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof EditPanel>

export default meta
type Story = StoryObj<typeof meta>

// The draft's changes, the faces of who typed in each, and what committing does to comments.
// Committing asks first, even with nobody else in the draft.
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
    const commit = within(await body.findByRole('dialog', { name: 'Commit as v4' }))
    await expect(commit.getByText('3 changes.')).toBeVisible()
    await expect(args.onCommit).not.toHaveBeenCalled()
    await userEvent.click(commit.getByRole('button', { name: 'Commit' }))
    await expect(args.onCommit).toHaveBeenCalled()
  },
}

// Committing lists the files it takes, shaped like the Files tree: a rename is the old name struck
// through beside the new one, and a file opens its comparison
export const CommitFiles: Story = {
  args: { commitFiles, files: 6 },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    const commit = within(await body.findByRole('dialog', { name: 'Commit as v4' }))
    await expect(commit.getByText('3 changes in 6 files.')).toBeVisible()
    const files = within(commit.getByRole('list', { name: 'Files' }))
    await expect(files.getByText('research')).toHaveStyle({ textDecorationLine: 'line-through' })
    await expect(files.getByText('Renamed · 3 files')).toBeVisible()
    await expect(
      files.getByRole('button', { name: /^was notes\/sync-states\.md ?sync-states\.md ?Moved$/ }),
    ).toBeVisible()
    // a folder isn't a button; a file opens its comparison, closing the dialog
    await expect(files.queryByRole('button', { name: /^decisions/ })).toBeNull()
    await userEvent.click(files.getByRole('button', { name: /^interviews\.md/ }))
    await expect(args.onCompareFile).toHaveBeenCalledWith('f2')
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
  },
}

// Many files: the list scrolls in the dialog
export const CommitManyFiles: Story = {
  args: { commitFiles: manyFiles, files: 36 },
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    const list = (await body.findByRole('dialog', { name: 'Commit as v4' })).querySelector('.commit-files')!
    await waitFor(() => expect(list.scrollHeight).toBeGreaterThan(list.clientHeight))
  },
}

// With others in the draft, committing names who it takes from, and warns while one is still typing
export const CommittingTogether: Story = {
  args: { together, commitFiles },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    await expect(args.onCommit).not.toHaveBeenCalled()
    await expect(
      body.getByText('3 changes in 2 files, by Priya Natarajan, Maya Chen, Agent for Tomás and you.'),
    ).toBeVisible()
    await expect(body.getByRole('alert')).toHaveTextContent(
      'Priya Natarajan is still typing in “Why”. Anything typed after you commit isn’t in v4: it stays in the draft for the next version.',
    )
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
    const body = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('button', { name: 'Preview' })).toBeEnabled()
    await userEvent.click(page.getByRole('button', { name: 'Commit as v4' }))
    const commit = within(await body.findByRole('dialog', { name: 'Commit as v4' }))
    await expect(commit.getByText('What you’ve just typed: it’s saved, then committed.')).toBeVisible()
    await userEvent.click(commit.getByRole('button', { name: 'Commit' }))
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
