// An idea's files as a tree of folders (docs: Files in the browser, Folders). A folder exists only
// while a file is in it, as in git, so the tree is worked out from the paths alone.
//
// - **Order:** folders above files, each sorted by name.
// - **Chains:** a folder holding nothing but one other folder shares its row with it
//   (packages/server/docs), as VS Code's Explorer does, so deep, sparse paths stay short.
// - **A closed folder says what's inside:** its open comments, and whether the draft makes, changes or
//   deletes anything in it (a rename alone isn't marked: the commit lists it). A folder whose files
//   are all deleted in the draft is deleted too.
// - **Open by default:** a folder is open unless it's been closed, and the one holding the file being
//   read is always open.
// - Rows don't assume Markdown: a file is any path (an image is a file too).

/**
 * What the draft does to a file. A file renamed and changed is `changed`, with `was`; `renamed` is a
 * rename alone, which the tree doesn't mark.
 */
export type FileState = 'new' | 'renamed' | 'deleted' | 'changed'

export interface TreeFile {
  /** The file's ID. */
  id: string
  path: string
  /** What the draft does to it; none for a file as the version has it. */
  state?: FileState | null
  /** Its path in the latest version, when the draft renames it. */
  was?: string | null
  /** Open comments on it. */
  comments?: number
}

export interface FolderNode {
  kind: 'folder'
  /** Its path from the top: `packages/server/docs`. */
  path: string
  /** What its row shows: its own name, or a chain of names (`packages/server/docs`). */
  name: string
  folders: FolderNode[]
  files: FileNode[]
  /** Every file under it, however deep. */
  count: number
  /** Open comments on the files under it. */
  comments: number
  /** The draft makes, changes or deletes something under it (a rename alone doesn't count). */
  changed: boolean
  /** Every file under it is deleted in the draft. */
  deleted: boolean
}

export interface FileNode {
  kind: 'file'
  file: TreeFile
  /** Its name, without the folders. */
  name: string
}

/** A row of the tree as it shows: how deep it is, and for a folder, whether it's open. */
export type TreeRow =
  | { kind: 'folder'; node: FolderNode; depth: number; open: boolean; parent: string | null }
  | { kind: 'file'; node: FileNode; depth: number; parent: string | null }

/** The tree of `files`: the top level as a folder with no path. */
export function buildTree(files: readonly TreeFile[]): FolderNode {
  const root = emptyFolder('', '')
  for (const file of files) {
    const parts = file.path.split('/')
    let folder = root
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part
      let next = folder.folders.find((f) => f.path === path)
      if (!next) {
        next = emptyFolder(path, part)
        folder.folders.push(next)
      }
      folder = next
    }
    folder.files.push({ kind: 'file', file, name: parts.at(-1)! })
  }
  return finish(root, true)
}

/** The rows that show: closed folders' insides left out, except the folder holding `current`. */
export function visibleRows(root: FolderNode, closed: ReadonlySet<string>, current: string | null): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (folder: FolderNode, depth: number) => {
    const parent = folder.path || null
    for (const sub of folder.folders) {
      const open = !closed.has(sub.path) || (current !== null && current.startsWith(`${sub.path}/`))
      rows.push({ kind: 'folder', node: sub, depth, open, parent })
      if (open) {
        walk(sub, depth + 1)
      }
    }
    for (const file of folder.files) {
      rows.push({ kind: 'file', node: file, depth, parent })
    }
  }
  walk(root, 0)
  return rows
}

/** Every folder's path in the tree, a chain's middle folders too. */
export function folderPaths(files: readonly TreeFile[]): Set<string> {
  const out = new Set<string>()
  for (const { path } of files) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      out.add(parts.slice(0, i).join('/'))
    }
  }
  return out
}

/**
 * What a file's mark means, said in words: the tooltip on its name (its color says it at a glance),
 * and what a screen reader hears after the name. Null for a file the draft leaves alone.
 */
export function stateHint(state: FileState | null | undefined, was?: string | null): string | null {
  const from = was ? `, renamed from ${was}` : ''
  switch (state) {
    case 'new':
      return 'New in the draft'
    case 'changed':
      return `Changed in the draft${from}`
    case 'renamed':
      return was ? `Renamed in the draft, from ${was}` : null
    case 'deleted':
      return 'Deleted in the draft: it goes when the draft is committed'
    default:
      return null
  }
}

/** A closed folder's mark, in words. */
export function folderHint(folder: Pick<FolderNode, 'changed' | 'deleted'>): string | null {
  if (folder.deleted) {
    return 'Deleted in the draft, with everything in it'
  }
  return folder.changed ? 'The draft makes, changes or deletes something in it' : null
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i

/** Whether a path is an image's, for its icon. */
export function isImage(path: string): boolean {
  return IMAGE.test(path)
}

/** The folder a path is in (`research` for research/notes.md), or '' at the top. */
export function folderOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

function emptyFolder(path: string, name: string): FolderNode {
  return { kind: 'folder', path, name, folders: [], files: [], count: 0, comments: 0, changed: false, deleted: false }
}

/** Sorts, totals and joins chains, from the bottom up. */
function finish(folder: FolderNode, top = false): FolderNode {
  let node = folder
  node.folders = node.folders.map((f) => finish(f)).sort((a, b) => byName(a.name, b.name))
  node.files.sort((a, b) => byName(a.name, b.name))
  // a folder holding only one other folder: one row for both
  if (!top && node.files.length === 0 && node.folders.length === 1) {
    const only = node.folders[0]!
    node = { ...only, name: `${node.name}/${only.name}` }
  }
  const files = node.files.map((f) => f.file)
  node.count = files.length + node.folders.reduce((n, f) => n + f.count, 0)
  node.comments = files.reduce((n, f) => n + (f.comments ?? 0), 0) + node.folders.reduce((n, f) => n + f.comments, 0)
  node.changed = files.some((f) => !!f.state && f.state !== 'renamed') || node.folders.some((f) => f.changed)
  node.deleted = node.count > 0 && files.every((f) => f.state === 'deleted') && node.folders.every((f) => f.deleted)
  return node
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
