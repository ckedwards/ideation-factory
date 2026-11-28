import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, screen } from 'storybook/test'
import { FileTree, type FileTreeActions, type FileTreeFile, type FileTreeProps, type NameBox } from './FileTree.tsx'

const file = (id: string, path: string, more: Partial<FileTreeFile> = {}): FileTreeFile => ({
  id,
  path,
  href: `#${path}`,
  ...more,
})

const plain = [file('f1', 'offline.md', { comments: 2 }), file('f2', 'sync-states.md'), file('f3', 'rollout.md')]

const tree = [
  file('f1', 'offline.md', { comments: 1 }),
  file('f2', 'sync-states.md'),
  file('f3', 'research/interviews.md'),
  file('f4', 'research/open-questions.md'),
  file('f5', 'research/competitors/notion.md', { comments: 3 }),
  file('f6', 'research/competitors/linear.md'),
  file('f7', 'decisions/queue.md', { comments: 2 }),
  file('f8', 'decisions/conflicts.md'),
]

// what the draft does: a file made, one renamed, one changed, one deleted, and a folder deleted
const inTheDraft = [
  file('f1', 'offline.md', { state: 'changed' }),
  file('f2', 'states.md', { state: 'renamed', was: 'sync-states.md' }),
  file('f3', 'sync-queue.md', { state: 'deleted' }),
  file('f9', 'research/interviews.md', { state: 'new' }),
  file('f4', 'research/open-questions.md'),
  file('f5', 'notes/standup.md', { comments: 2, state: 'changed' }),
  file('f7', 'decisions/queue.md', { state: 'deleted' }),
]

// a repository's Markdown, sparse and deep, and an image beside a page
const deep = [
  file('f1', 'README.md'),
  file('f2', 'packages/server/docs/storage.md'),
  file('f3', 'packages/server/docs/sync.md', { comments: 1 }),
  file('f4', 'packages/web/docs/routing.md'),
  file('f5', 'docs/adr/0001-rivet.md'),
  file('f6', 'docs/adr/0002-bun.md'),
  file('f7', 'docs/images/architecture.png'),
]

// a long tree: 60 files over 12 folders
const long = Array.from({ length: 60 }, (_, i) =>
  file(
    `f${i + 1}`,
    `area-${String(Math.floor(i / 5) + 1).padStart(2, '0')}/note-${(i % 5) + 1}.md`,
    i % 7 === 0 ? { comments: 1 } : {},
  ),
)

const pathProblem = (path: string) => {
  if (path.length > 512) {
    return 'A path can be 512 characters at most'
  }
  if (path.includes('\\') || path.split('/').some((p) => p === '' || p === '.' || p === '..')) {
    return 'Use / between folders'
  }
  return null
}

const actions = (): FileTreeActions => ({
  onCreate: fn(),
  onRename: fn(),
  onDelete: fn(),
  onRestore: fn(),
  onRenameFolder: fn(),
  onDeleteFolder: fn(),
  onRestoreFolder: fn(),
  pathProblem,
})

/** The tree with the folders it closes kept, as the page keeps them. */
function Tree(props: Omit<FileTreeProps, 'onClosedChange'> & { editable?: boolean }) {
  const [closed, setClosed] = useState(props.closed)
  const { editable = true, ...rest } = props
  return (
    <div style={{ width: '15rem' }}>
      <FileTree {...rest} closed={closed} onClosedChange={setClosed} {...(editable ? { actions: actions() } : {})} />
    </div>
  )
}

const meta = {
  title: 'Ideas/FileTree',
  component: Tree,
  args: { files: tree, current: 'offline.md', closed: ['decisions'] },
} satisfies Meta<typeof Tree>

export default meta
type Story = StoryObj<typeof meta>

/** With no folders, the list it always was. */
export const Plain: Story = { args: { files: plain, closed: [] } }

/** Folders above files; a closed folder shows the open comments inside it. */
export const Folders: Story = {}

/** Without edit access: no `+`, no ⋯. */
export const ReadOnly: Story = { args: { editable: false } }

/** The draft's file changes: new, renamed (pointing says what it was), changed, deleted, and a folder deleted. */
export const InTheDraft: Story = {
  args: { files: inTheDraft, closed: ['notes'] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('states.md')).toHaveAttribute('title', 'was sync-states.md')
    await expect(canvas.getByText('· new')).toBeVisible()
    // a closed folder with a change inside says so
    await expect(canvas.getByRole('treeitem', { name: /notes/ })).toHaveTextContent('· changed')
  },
}

/** A file's menu. */
export const FileMenu: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'offline.md: actions' }))
    await expect(await screen.findByRole('menuitem', { name: /Rename/ })).toBeVisible()
    await expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeVisible()
  },
}

/** A deleted file's menu restores it. */
export const DeletedFileMenu: Story = {
  args: { files: inTheDraft, closed: [] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'sync-queue.md: actions' }))
    await expect(await screen.findByRole('menuitem', { name: 'Restore' })).toBeVisible()
  },
}

/** A folder's menu. */
export const FolderMenu: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'research: actions' }))
    await expect(await screen.findByRole('menuitem', { name: 'New file here' })).toBeVisible()
    await expect(screen.getByRole('menuitem', { name: /Rename folder/ })).toBeVisible()
    await expect(screen.getByRole('menuitem', { name: 'Delete folder' })).toBeVisible()
  },
}

/** An idea keeps at least one file: its last can't be deleted, and says why. */
export const LastFile: Story = {
  args: { files: [file('f1', 'plan.md')], current: 'plan.md', closed: [] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'plan.md: actions' }))
    const del = await screen.findByRole('menuitem', { name: /Delete/ })
    await expect(del).toHaveAttribute('data-disabled')
    await expect(del).toHaveTextContent('An idea keeps at least one file.')
  },
}

/** `+` opens a name box at the end, with .md fixed after it. */
export const Making: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'New file' }))
    const box = canvas.getByRole('textbox', { name: 'New file name' })
    await expect(box).toHaveFocus()
    await userEvent.type(box, 'research/costs')
    await expect(canvas.getByRole('status')).toHaveTextContent('In research')
    await userEvent.keyboard('{Enter}')
  },
}

const named = (box: NameBox): Partial<FileTreeProps> => ({ defaultNameBox: box })

/** Making a file in a folder that doesn't exist yet makes the folder. */
export const MakingAFolder: Story = { args: named({ kind: 'create', folder: '', value: 'reserch/costs' }) }

/** New file here: the name box inside the folder. */
export const MakingInAFolder: Story = { args: named({ kind: 'create', folder: 'research', value: 'costs' }) }

/** A name another file has. */
export const NameTaken: Story = {
  args: named({ kind: 'create', folder: '', value: 'offline' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('There’s already a file called offline.md')
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
  },
}

/** No name: said once Enter is pressed. */
export const NameEmpty: Story = {
  args: named({ kind: 'create', folder: '' }),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('A name can’t be empty')
  },
}

/** A path the idea's rules don't take. */
export const NameNotAPath: Story = {
  args: named({ kind: 'create', folder: '', value: 'research//costs' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Use / between folders')
  },
}

/** Renaming: the whole path, the name selected. */
export const Renaming: Story = {
  args: named({ kind: 'rename', file: 'f2' }),
  play: async ({ canvas }) => {
    const box = canvas.getByRole<HTMLInputElement>('textbox', { name: 'Rename sync-states.md' })
    await expect(box).toHaveValue('sync-states')
    await expect(box.selectionStart).toBe(0)
  },
}

/** Moving a file is changing the folders in front of its name; a typo makes a new folder, and says so. */
export const Moving: Story = {
  args: named({ kind: 'rename', file: 'f4', value: 'reserch/open-questions' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Makes a new folder, reserch')
  },
}

/** Renaming a folder moves its files. */
export const RenamingAFolder: Story = {
  args: named({ kind: 'rename-folder', folder: 'research', value: 'findings' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Its 4 files move with it. Links to them are updated.')
  },
}

/** A folder holding only a folder shares its row; an image is a file like any other. */
export const SparseAndDeep: Story = { args: { files: deep, current: 'README.md', closed: [] } }

/** Many files: folders closed but the one being read. */
export const Long: Story = {
  args: {
    files: long,
    current: 'area-04/note-2.md',
    closed: Array.from({ length: 12 }, (_, i) => `area-${String(i + 1).padStart(2, '0')}`),
  },
}

/** Up and Down move, Right opens a folder and goes in, Left closes it or goes up. */
export const Keys: Story = {
  play: async ({ canvas, userEvent }) => {
    const rows = () => canvas.getAllByRole('treeitem')
    rows()[0]!.focus()
    // decisions, closed
    await userEvent.keyboard('{ArrowRight}')
    await expect(rows()[0]).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{ArrowRight}')
    await expect(rows()[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(rows()[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(rows()[0]).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{ArrowDown}')
    await expect(rows()[1]).toHaveFocus()
    // F2 renames the folder in focus
    await userEvent.keyboard('{F2}')
    await expect(canvas.getByRole('textbox', { name: 'Rename folder research' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
  },
}
