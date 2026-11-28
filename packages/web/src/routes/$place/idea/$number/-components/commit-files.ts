// The files a commit takes, as its dialog lists them (docs: Committing the draft): shaped like the
// Files tree, with only the files the draft touches and the folders above them, each with what happens
// to it. A rename is the old name struck through beside the new one, and the only place a rename shows.
//
// - **Order:** the tree's: folders above files, each by name.
// - **A folder renamed is one row:** every file it had moved to the same place under a new name
//   (research to findings) is "~~research~~ findings, Renamed · 12 files" (Moved, into another
//   folder), and its files are listed under it only when they're also changed.
// - **A file renamed** in its folder says Renamed; to another folder, Moved, its old path struck through.
// - **A folder the draft empties** is deleted, struck through as the Files tree has it.

export interface CommitFileInput {
  file: string
  path: string
  content: string
  /** Made in the draft. */
  made: string | null
  /** Its path in the latest version, when the draft renames it. */
  was: string | null
}

export interface CommitRow {
  kind: 'folder' | 'file'
  /** Its path now: a key, and the folder a file is in. */
  path: string
  /** What the row shows: the folder's or file's name. */
  name: string
  depth: number
  /** What it was called, struck through beside it: a name in the same folder, or a whole path. */
  was: string | null
  /** A file's ID, to open its comparison; null for a folder. */
  file: string | null
  state: 'new' | 'changed' | 'deleted' | null
  /** On the right: New, Edited, Deleted, Renamed, Moved, "Renamed · 3 files". */
  note: string | null
}

/** The rows, from the draft's files, the ones it deletes, and the latest version's text of each. */
export function commitRows(
  files: readonly CommitFileInput[],
  deleted: ReadonlyArray<{ file: string; path: string }>,
  latest: ReadonlyMap<string, string>,
): CommitRow[] {
  const changed = (f: CommitFileInput) => f.made === null && latest.get(f.file) !== f.content
  // where each file was in the latest version: a new file wasn't anywhere
  const before = [
    ...files.filter((f) => f.made === null).map((f) => ({ f, old: f.was ?? f.path })),
    ...deleted.map((d) => ({ f: null, old: d.path })),
  ]
  const renamed = files.filter((f) => f.was !== null)

  // each renamed file's folder rename: the shallowest folder whose files all moved the same way
  const folderOf = new Map<string, { from: string; to: string }>()
  for (const f of renamed) {
    for (const { from, to, rest } of splits(f.was!, f.path)) {
      const whole = before.every(
        ({ f: other, old }) => !old.startsWith(`${from}/`) || other?.path === `${to}/${old.slice(from.length + 1)}`,
      )
      if (whole && rest) {
        folderOf.set(f.file, { from, to })
        break
      }
    }
  }
  // a folder rename is two files or more: one alone is a file moved
  const folders = new Map<string, { from: string; count: number }>()
  for (const { from, to } of folderOf.values()) {
    const had = folders.get(to)
    folders.set(to, { from, count: (had?.count ?? 0) + 1 })
  }
  for (const [file, { to }] of folderOf) {
    if (folders.get(to)!.count < 2) {
      folderOf.delete(file)
      folders.delete(to)
    }
  }

  // the files that show, each with what happens to it
  const shown: CommitRow[] = []
  const fileRow = (path: string, rest: Omit<CommitRow, 'kind' | 'path' | 'name' | 'depth'>): CommitRow => ({
    kind: 'file',
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    depth: 0,
    ...rest,
  })
  for (const f of files) {
    const edited = changed(f)
    if (f.made !== null) {
      shown.push(fileRow(f.path, { file: f.file, state: 'new', was: null, note: 'New' }))
    } else if (f.was !== null && !folderOf.has(f.file)) {
      const sameFolder = parent(f.was) === parent(f.path)
      shown.push(
        fileRow(f.path, {
          file: f.file,
          state: edited ? 'changed' : null,
          was: sameFolder ? f.was.slice(f.was.lastIndexOf('/') + 1) : f.was,
          note: `${sameFolder ? 'Renamed' : 'Moved'}${edited ? ' · edited' : ''}`,
        }),
      )
    } else if (edited) {
      shown.push(fileRow(f.path, { file: f.file, state: 'changed', was: null, note: 'Edited' }))
    }
  }
  for (const d of deleted) {
    shown.push(fileRow(d.path, { file: d.file, state: 'deleted', was: null, note: 'Deleted' }))
  }

  // the folders above them, and the folders renamed (shown even with none of their files)
  const folderPaths = new Set<string>()
  const addAbove = (path: string) => {
    for (let at = path.indexOf('/'); at > 0; at = path.indexOf('/', at + 1)) {
      folderPaths.add(path.slice(0, at))
    }
  }
  shown.forEach((r) => addAbove(r.path))
  for (const to of folders.keys()) {
    addAbove(`${to}/x`)
  }

  const rows: CommitRow[] = []
  const walk = (folder: string, depth: number) => {
    const inside = (path: string) => parent(path) === folder
    for (const path of [...folderPaths].filter(inside).sort(byName)) {
      const renamedFolder = folders.get(path)
      // a folder the draft empties goes, as the Files tree strikes it through
      const emptied = !renamedFolder && !files.some((f) => f.path.startsWith(`${path}/`))
      const sameFolder = renamedFolder !== undefined && parent(renamedFolder.from) === parent(path)
      rows.push({
        kind: 'folder',
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        depth,
        was: renamedFolder
          ? sameFolder
            ? renamedFolder.from.slice(renamedFolder.from.lastIndexOf('/') + 1)
            : renamedFolder.from
          : null,
        file: null,
        state: emptied ? 'deleted' : null,
        note: renamedFolder
          ? `${sameFolder ? 'Renamed' : 'Moved'} · ${renamedFolder.count} files`
          : emptied
            ? 'Deleted'
            : null,
      })
      walk(path, depth + 1)
    }
    for (const row of shown.filter((r) => inside(r.path)).sort((a, b) => byName(a.name, b.name))) {
      rows.push({ ...row, depth })
    }
  }
  walk('', 0)
  return rows
}

/** The ways one path maps to another by a folder: from the shallowest folder down. */
function splits(was: string, path: string): Array<{ from: string; to: string; rest: string }> {
  const out: Array<{ from: string; to: string; rest: string }> = []
  for (let at = was.indexOf('/'); at > 0; at = was.indexOf('/', at + 1)) {
    const rest = was.slice(at + 1)
    if (path.endsWith(`/${rest}`)) {
      const to = path.slice(0, path.length - rest.length - 1)
      const from = was.slice(0, at)
      if (from !== to) {
        out.push({ from, to, rest })
      }
    }
  }
  return out
}

function parent(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
