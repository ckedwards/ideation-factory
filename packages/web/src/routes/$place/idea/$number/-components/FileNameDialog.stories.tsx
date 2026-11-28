import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen } from 'storybook/test'
import { FileNameDialog } from './FileNameDialog.tsx'
import { friendlyPathProblem } from './file-actions.tsx'

const files = [
  { id: 'f1', path: 'plan.md' },
  { id: 'f2', path: 'research/interviews.md' },
]
const actions = {
  onCreate: fn(),
  onRename: fn(),
  onDelete: fn(),
  onRestore: fn(),
  onRenameFolder: fn(),
  onDeleteFolder: fn(),
  onRestoreFolder: fn(),
  pathProblem: friendlyPathProblem,
}

const meta = {
  title: 'Ideas/FileNameDialog',
  component: FileNameDialog,
  args: { box: { kind: 'create', folder: '' }, files, actions, onClose: fn() },
} satisfies Meta<typeof FileNameDialog>

export default meta
type Story = StoryObj<typeof meta>

/** New file, from the focus view's top line: a new folder says so. */
export const NewFile: Story = {
  play: async ({ args, userEvent }) => {
    await userEvent.type(await screen.findByRole('textbox', { name: 'New file name' }), 'decisions/offline')
    await expect(screen.getByRole('status')).toHaveTextContent('Makes a new folder, decisions')
    await userEvent.click(screen.getByRole('button', { name: 'Make it' }))
    await expect(args.actions.onCreate).toHaveBeenCalledWith('decisions/offline.md')
  },
}

/** Renaming the open file, from its line's ⋯. */
export const Renaming: Story = {
  args: { box: { kind: 'rename', file: 'f2' } },
  play: async ({ args, userEvent }) => {
    const box = await screen.findByRole('textbox', { name: 'Rename research/interviews.md' })
    await userEvent.clear(box)
    await userEvent.type(box, 'research/people')
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await expect(args.actions.onRename).toHaveBeenCalledWith('f2', 'research/people.md')
  },
}

/** A name another file has. */
export const NameTaken: Story = {
  args: { box: { kind: 'create', folder: '', value: 'plan' } },
  play: async () => {
    await expect(await screen.findByRole('status')).toHaveTextContent('There’s already a file called plan.md')
  },
}
