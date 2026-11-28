// An idea's Files list, as a tree of folders (docs: Files in the browser). Folders above files, a
// chain of folders holding only a folder on one row, and what the draft does to each file beside it:
// new, renamed, changed, or struck through and deleted. A closed folder shows the comments and changes
// inside it; which folders are closed is the page's to keep.
//
// For someone who can edit, `+` beside the label makes a file, and each row's ⋯ renames or deletes
// it (a folder's makes a file in it, renames or deletes it); a deleted one is restored the same way.
// Making and renaming happen in a name box in the row, checked as you type. Keys: Up and Down move,
// Right opens a folder, Left closes it or goes up, Enter opens, F2 renames, Delete deletes.
import { type CSSProperties, Fragment, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { RowMenu, type RowMenuItem } from '../controls/RowMenu.tsx'
import {
  buildTree,
  type FolderNode,
  folderOf,
  folderPaths,
  type TreeFile,
  type TreeRow,
  visibleRows,
} from './file-tree.ts'
import './FileTree.css'

export interface FileTreeFile extends TreeFile {
  href: string
}

export interface FileTreeActions {
  /** A new file, at its whole path. */
  onCreate: (path: string) => void
  onRename: (file: string, path: string) => void
  /** Asks first, then deletes: the page's to ask. */
  onDelete: (file: string) => void
  onRestore: (file: string) => void
  onRenameFolder: (folder: string, to: string) => void
  onDeleteFolder: (folder: string) => void
  onRestoreFolder: (folder: string) => void
  /** Why a file can't have this path (the idea's rules for paths), or null if it can. */
  pathProblem: (path: string) => string | null
}

/** The name box, where it's open: making a file (in a folder, or at the top), or renaming one. */
export type NameBox =
  | { kind: 'create'; folder: string; value?: string }
  | { kind: 'rename'; file: string; value?: string }
  | { kind: 'rename-folder'; folder: string; value?: string }

export interface FileTreeProps {
  files: FileTreeFile[]
  /** The path of the file being read. */
  current: string | null
  /** The folders closed, by path. */
  closed: readonly string[]
  onClosedChange: (closed: string[]) => void
  /** For someone who can edit; without, the tree only reads. */
  actions?: FileTreeActions
  /** Enter on a file; without, its link is followed. */
  onOpen?: (file: FileTreeFile) => void
  /** The label's class, to match the rail's other labels. */
  labelClassName?: string
  /** The name box open to start with (for stories and tests). */
  defaultNameBox?: NameBox | null
}

const EXTENSION = '.md'

export function FileTree({
  files,
  current,
  closed,
  onClosedChange,
  actions,
  onOpen,
  labelClassName,
  defaultNameBox = null,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files])
  const closedSet = useMemo(() => new Set(closed), [closed])
  const rows = useMemo(() => visibleRows(tree, closedSet, current), [tree, closedSet, current])
  const folders = useMemo(() => folderPaths(files), [files])
  const [box, setBox] = useState<NameBox | null>(defaultNameBox)
  const [focused, setFocused] = useState(0)
  const items = useRef<Array<HTMLElement | null>>([])
  const labelId = useId()
  const live = files.filter((f) => f.state !== 'deleted')
  const byId = new Map(files.map((f) => [f.id, f]))

  const setOpen = (folder: string, open: boolean) => {
    const next = new Set(closedSet)
    if (open) {
      next.delete(folder)
    } else {
      next.add(folder)
    }
    onClosedChange([...next])
  }
  const focusRow = (i: number) => {
    const at = Math.max(0, Math.min(rows.length - 1, i))
    setFocused(at)
    items.current[at]?.focus()
  }

  const menuFor = (row: TreeRow): RowMenuItem[] => {
    if (!actions) {
      return []
    }
    if (row.kind === 'file') {
      const { file } = row.node
      if (file.state === 'deleted') {
        return [{ label: 'Restore', onSelect: () => actions.onRestore(file.id) }]
      }
      return [
        { label: 'Rename', shortcut: 'F2', onSelect: () => setBox({ kind: 'rename', file: file.id }) },
        {
          label: 'Delete',
          danger: true,
          onSelect: () => actions.onDelete(file.id),
          ...(live.length <= 1 ? { unavailable: 'An idea keeps at least one file.' } : {}),
        },
      ]
    }
    const folder = row.node
    if (folder.deleted) {
      return [{ label: 'Restore folder', onSelect: () => actions.onRestoreFolder(folder.path) }]
    }
    const holdsAll = live.every((f) => f.path.startsWith(`${folder.path}/`))
    return [
      {
        label: 'New file here',
        onSelect: () => {
          setOpen(folder.path, true)
          setBox({ kind: 'create', folder: folder.path })
        },
      },
      {
        label: 'Rename folder',
        shortcut: 'F2',
        onSelect: () => setBox({ kind: 'rename-folder', folder: folder.path }),
      },
      {
        label: 'Delete folder',
        danger: true,
        onSelect: () => actions.onDeleteFolder(folder.path),
        ...(holdsAll ? { unavailable: 'An idea keeps at least one file.' } : {}),
      },
    ]
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, [role="menu"]')) {
      return
    }
    const row = rows[focused]
    if (!row) {
      return
    }
    const parentAt = () => rows.findIndex((r) => r.kind === 'folder' && r.node.path === row.parent)
    switch (event.key) {
      case 'ArrowDown':
        focusRow(focused + 1)
        break
      case 'ArrowUp':
        focusRow(focused - 1)
        break
      case 'Home':
        focusRow(0)
        break
      case 'End':
        focusRow(rows.length - 1)
        break
      case 'ArrowRight':
        if (row.kind === 'folder') {
          if (row.open) {
            focusRow(focused + 1)
          } else {
            setOpen(row.node.path, true)
          }
        }
        break
      case 'ArrowLeft':
        if (row.kind === 'folder' && row.open && !current?.startsWith(`${row.node.path}/`)) {
          setOpen(row.node.path, false)
        } else if (row.parent !== null) {
          focusRow(parentAt())
        }
        break
      case 'Enter':
        if (row.kind === 'folder') {
          setOpen(row.node.path, !row.open)
        } else {
          open(row.node.file.id)
        }
        break
      case 'F2':
        if (actions && row.kind === 'file' && row.node.file.state !== 'deleted') {
          setBox({ kind: 'rename', file: row.node.file.id })
        } else if (actions && row.kind === 'folder' && !row.node.deleted) {
          setBox({ kind: 'rename-folder', folder: row.node.path })
        } else {
          return
        }
        break
      case 'Delete':
        if (actions && row.kind === 'file' && row.node.file.state !== 'deleted' && live.length > 1) {
          actions.onDelete(row.node.file.id)
        } else if (actions && row.kind === 'folder' && !row.node.deleted) {
          actions.onDeleteFolder(row.node.path)
        } else {
          return
        }
        break
      default:
        return
    }
    event.preventDefault()
  }

  const open = (id: string) => {
    const file = byId.get(id)
    if (!file) {
      return
    }
    if (onOpen) {
      onOpen(file)
    } else {
      items.current[rows.findIndex((r) => r.kind === 'file' && r.node.file.id === id)]
        ?.querySelector<HTMLAnchorElement>('a')
        ?.click()
    }
  }

  // a name box for a new file: after its folder's rows, or at the end of the list
  const createAfter =
    box?.kind === 'create' && box.folder
      ? lastIndexWithin(rows, box.folder)
      : box?.kind === 'create'
        ? rows.length - 1
        : null

  const boxRow = (depth: number) =>
    box && actions ? (
      <NameBoxRow
        box={box}
        depth={depth}
        files={files}
        folders={folders}
        tree={tree}
        actions={actions}
        onDone={() => setBox(null)}
      />
    ) : null

  return (
    <nav className="file-tree" aria-labelledby={labelId}>
      <div className="file-tree-head">
        <h2 id={labelId} className={labelClassName ?? 'file-tree-label'}>
          Files
        </h2>
        {actions && (
          <button
            type="button"
            className="file-tree-add"
            aria-label="New file"
            title="New file"
            onClick={() => setBox({ kind: 'create', folder: '' })}
          >
            +
          </button>
        )}
      </div>
      <ul className="file-tree-rows" role="tree" aria-labelledby={labelId} onKeyDown={onKeyDown}>
        {createAfter === -1 && boxRow(box?.kind === 'create' && box.folder ? depthOf(rows, box.folder) + 1 : 0)}
        {rows.map((row, i) => {
          const renaming =
            (box?.kind === 'rename' && row.kind === 'file' && row.node.file.id === box.file) ||
            (box?.kind === 'rename-folder' && row.kind === 'folder' && row.node.path === box.folder)
          const tabIndex = i === Math.min(focused, rows.length - 1) ? 0 : -1
          return (
            <Fragment key={row.kind === 'file' ? row.node.file.id : `folder:${row.node.path}`}>
              {renaming ? (
                boxRow(row.depth)
              ) : (
                <Row
                  row={row}
                  tabIndex={tabIndex}
                  current={current}
                  menu={menuFor(row)}
                  onToggle={(open) => row.kind === 'folder' && setOpen(row.node.path, open)}
                  onFocus={() => setFocused(i)}
                  ref={(el) => {
                    items.current[i] = el
                  }}
                />
              )}
              {createAfter === i && boxRow(box?.kind === 'create' && box.folder ? depthOf(rows, box.folder) + 1 : 0)}
            </Fragment>
          )
        })}
      </ul>
    </nav>
  )
}

/** The last row inside a folder (or the folder's own, if it's empty or closed). */
function lastIndexWithin(rows: TreeRow[], folder: string): number {
  let last = rows.findIndex((r) => r.kind === 'folder' && r.node.path === folder)
  rows.forEach((r, i) => {
    const path = r.kind === 'folder' ? r.node.path : r.node.file.path
    if (path.startsWith(`${folder}/`)) {
      last = i
    }
  })
  return last
}

function depthOf(rows: TreeRow[], folder: string): number {
  return rows.find((r) => r.kind === 'folder' && r.node.path === folder)?.depth ?? -1
}

interface RowProps {
  row: TreeRow
  tabIndex: number
  current: string | null
  menu: RowMenuItem[]
  onToggle: (open: boolean) => void
  onFocus: () => void
  ref: (el: HTMLElement | null) => void
}

function Row({ row, tabIndex, current, menu, onToggle, onFocus, ref }: RowProps) {
  const indent = { '--file-tree-depth': row.depth } as CSSProperties
  if (row.kind === 'folder') {
    const folder = row.node
    return (
      <li
        ref={ref}
        role="treeitem"
        aria-expanded={row.open}
        aria-level={row.depth + 1}
        tabIndex={tabIndex}
        onFocus={onFocus}
        className={['file-tree-row', 'is-folder', folder.deleted && 'is-deleted'].filter(Boolean).join(' ')}
        style={indent}
      >
        <button type="button" tabIndex={-1} className="file-tree-folder" onClick={() => onToggle(!row.open)}>
          <span className="file-tree-caret" aria-hidden>
            {row.open ? '▾' : '▸'}
          </span>
          <span className="file-tree-name">{folder.name}</span>
        </button>
        {folder.deleted ? (
          <span className="file-tree-state"> · deleted</span>
        ) : (
          !row.open && folder.changed && <span className="file-tree-state is-changed"> · changed</span>
        )}
        {!row.open && folder.comments > 0 && <Comments n={folder.comments} />}
        {menu.length > 0 && (
          <RowMenu label={folder.path} groups={[{ items: menu }]} tabIndex={tabIndex} className="file-tree-menu" />
        )}
      </li>
    )
  }
  const { file, name } = row.node
  const state = file.state ?? null
  return (
    <li
      ref={ref}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-current={file.path === current ? 'page' : undefined}
      tabIndex={tabIndex}
      onFocus={onFocus}
      className={['file-tree-row', state === 'deleted' && 'is-deleted'].filter(Boolean).join(' ')}
      style={indent}
    >
      <a
        href={(file as FileTreeFile).href}
        tabIndex={-1}
        className="file-tree-name"
        aria-current={file.path === current ? 'page' : undefined}
        title={state === 'renamed' && file.was ? `was ${file.was}` : undefined}
      >
        {name}
      </a>
      {state && <span className={`file-tree-state is-${state}`}> · {state}</span>}
      {(file.comments ?? 0) > 0 && <Comments n={file.comments!} />}
      {menu.length > 0 && (
        <RowMenu label={file.path} groups={[{ items: menu }]} tabIndex={tabIndex} className="file-tree-menu" />
      )}
    </li>
  )
}

function Comments({ n }: { n: number }) {
  return (
    <span className="file-tree-comments" title={`${n} open comment${n === 1 ? '' : 's'}`}>
      {n}
    </span>
  )
}

interface NameBoxRowProps {
  box: NameBox
  depth: number
  files: FileTreeFile[]
  folders: Set<string>
  tree: FolderNode
  actions: FileTreeActions
  onDone: () => void
}

/** Making or renaming in the row: the name checked as you type, Enter to do it, Esc to leave it. */
function NameBoxRow({ box, depth, files, folders, tree, actions, onDone }: NameBoxRowProps) {
  const renamed = box.kind === 'rename' ? files.find((f) => f.id === box.file) : undefined
  // a file's extension stays as it is: a page's .md is fixed at the end of the box
  const extension = box.kind === 'rename-folder' ? '' : renamed ? extensionOf(renamed.path) : EXTENSION
  const start =
    box.value ??
    (box.kind === 'rename'
      ? (renamed?.path.slice(0, renamed.path.length - extension.length) ?? '')
      : box.kind === 'rename-folder'
        ? box.folder
        : '')
  const [value, setValue] = useState(start)
  // a problem shows once there's a name, or once Enter is pressed without one
  const [tried, setTried] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const hintId = useId()

  useEffect(() => {
    const el = input.current
    if (!el) {
      return
    }
    el.focus()
    // the name selected, the folders in front of it not
    const at = el.value.lastIndexOf('/') + 1
    el.setSelectionRange(at, el.value.length)
  }, [])

  const typed = value.trim()
  const path =
    box.kind === 'create'
      ? `${box.folder ? `${box.folder}/` : ''}${typed}${extension}`
      : box.kind === 'rename'
        ? `${typed}${extension}`
        : typed
  const problem = (() => {
    if (!typed) {
      return 'A name can’t be empty'
    }
    if (box.kind === 'rename-folder') {
      if (typed !== box.folder && (folders.has(typed) || files.some((f) => f.path === typed))) {
        return `There’s already a folder called ${typed}`
      }
      return actions.pathProblem(`${typed}/x${EXTENSION}`)
    }
    const self = box.kind === 'rename' ? box.file : null
    const taken = files.find((f) => f.id !== self && f.path.toLowerCase() === path.toLowerCase())
    if (taken) {
      return `There’s already a file called ${path}`
    }
    return actions.pathProblem(path)
  })()
  const note = (() => {
    if (problem) {
      return null
    }
    if (box.kind === 'rename-folder') {
      const n = countIn(tree, box.folder)
      return typed === box.folder ? null : `Its ${n} file${n === 1 ? '' : 's'} move with it. Links to them are updated.`
    }
    const to = folderOf(path)
    const from = box.kind === 'rename' ? folderOf(renamed?.path ?? '') : box.folder
    if (to === from) {
      return null
    }
    if (!folders.has(to) && to !== '') {
      return `Makes a new folder, ${to}`
    }
    return box.kind === 'create' ? `In ${to || 'the top'}` : `Moves it to ${to || 'the top'}`
  })()

  const submit = () => {
    if (problem) {
      setTried(true)
      return
    }
    if (box.kind === 'create') {
      actions.onCreate(path)
    } else if (box.kind === 'rename' && renamed && path !== renamed.path) {
      actions.onRename(renamed.id, path)
    } else if (box.kind === 'rename-folder' && typed !== box.folder) {
      actions.onRenameFolder(box.folder, typed)
    }
    onDone()
  }

  const showProblem = problem !== null && (typed !== '' || tried)
  const label =
    box.kind === 'create'
      ? 'New file name'
      : box.kind === 'rename'
        ? `Rename ${renamed?.path ?? ''}`
        : `Rename folder ${box.folder}`
  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      className="file-tree-row is-naming"
      style={{ '--file-tree-depth': depth } as CSSProperties}
    >
      <div className="file-tree-box">
        <input
          ref={input}
          className="file-tree-input"
          aria-label={label}
          aria-invalid={showProblem}
          aria-describedby={hintId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onDone()
            }
          }}
          onBlur={onDone}
        />
        {extension && <span className="file-tree-extension">{extension}</span>}
      </div>
      <p id={hintId} className={showProblem ? 'file-tree-hint is-problem' : 'file-tree-hint'} role="status">
        {showProblem ? problem : note}
      </p>
    </li>
  )
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const at = name.lastIndexOf('.')
  return at > 0 ? name.slice(at) : ''
}

function countIn(tree: FolderNode, folder: string): number {
  const find = (node: FolderNode): FolderNode | null =>
    node.path === folder ? node : node.folders.reduce<FolderNode | null>((hit, f) => hit ?? find(f), null)
  return find(tree)?.count ?? 0
}
