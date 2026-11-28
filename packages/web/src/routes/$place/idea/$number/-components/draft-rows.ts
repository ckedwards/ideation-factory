// The draft's changes as the list of changes shows them (docs: Files in the browser, In the draft's
// dialogs): one row each, except a folder renamed or deleted, which is a rename or delete of each of its
// files underneath and one row here, "Renamed research to findings (4 files)", with one Undo.
import type { DraftChange } from '@ideaf/core'

/** A change as the draft read has it. */
export interface DraftChangeEntry {
  key: string
  change: DraftChange
  by: { user: string; bot: string | null }
  at: number
}

/** A row of the list: the changes it stands for (Undo takes them all back) and what it says. */
export interface DraftRow<T extends DraftChangeEntry> {
  /** Its first change's key: the row's own. */
  key: string
  keys: string[]
  entries: T[]
  /** For a folder renamed or deleted: what to call it; null for a row of one change. */
  folder: { label: string } | null
}

/**
 * The rows: renames, or deletes, made together (one request, by one caller) of every file in a
 * folder are one row; everything else, a row each. `deletedPath` names a file the draft deletes;
 * `livePaths`, the draft's files, to tell a folder deleted whole from some of its files.
 */
export function rowsOf<T extends DraftChangeEntry>(
  entries: readonly T[],
  deletedPath: (file: string) => string | null,
  livePaths: readonly string[],
): Array<DraftRow<T>> {
  const rows: Array<DraftRow<T>> = []
  let i = 0
  while (i < entries.length) {
    const first = entries[i]!
    const kind = first.change.kind
    let j = i + 1
    if (kind === 'rename-file' || kind === 'delete-file') {
      while (j < entries.length && together(first, entries[j]!)) {
        j++
      }
    }
    const run = entries.slice(i, j)
    const folder =
      run.length < 2
        ? null
        : kind === 'rename-file'
          ? renamedFolder(run.map((e) => e.change as Extract<DraftChange, { kind: 'rename-file' }>))
          : deletedFolder(
              run.map((e) => deletedPath((e.change as Extract<DraftChange, { kind: 'delete-file' }>).file)),
              livePaths,
            )
    if (folder) {
      rows.push({ key: first.key, keys: run.map((e) => e.key), entries: run, folder: { label: folder } })
    } else {
      for (const e of run) {
        rows.push({ key: e.key, keys: [e.key], entries: [e], folder: null })
      }
    }
    i = j
  }
  return rows
}

/** Made in the same go: the same kind of file change, at the same moment, by the same caller. */
function together(a: DraftChangeEntry, b: DraftChangeEntry): boolean {
  return a.change.kind === b.change.kind && a.at === b.at && a.by.user === b.by.user && a.by.bot === b.by.bot
}

/** "Renamed research to findings (4 files)", if the renames move one folder's files together. */
function renamedFolder(renames: Array<Extract<DraftChange, { kind: 'rename-file' }>>): string | null {
  const first = renames[0]!
  // from the deepest folder of the first file's path up, the first that maps every file the same way
  for (let at = first.was.lastIndexOf('/'); at > 0; at = first.was.lastIndexOf('/', at - 1)) {
    const from = first.was.slice(0, at)
    const rest = first.was.slice(at + 1)
    if (!first.path.endsWith(`/${rest}`)) {
      continue
    }
    const to = first.path.slice(0, first.path.length - rest.length - 1)
    const all = renames.every((r) => r.was.startsWith(`${from}/`) && r.path === `${to}/${r.was.slice(from.length + 1)}`)
    if (all) {
      return `Renamed ${from} to ${to} (${renames.length} files)`
    }
  }
  return null
}

/** "Deleted research (4 files)", if the deletes leave a folder with nothing in it. */
function deletedFolder(paths: Array<string | null>, livePaths: readonly string[]): string | null {
  if (paths.some((p) => p === null)) {
    return null
  }
  const folders = (paths as string[]).map((p) => p.split('/').slice(0, -1))
  const common: string[] = []
  for (let i = 0; folders.every((f) => i < f.length && f[i] === folders[0]![i]); i++) {
    common.push(folders[0]![i]!)
  }
  const folder = common.join('/')
  if (!folder || livePaths.some((p) => p.startsWith(`${folder}/`))) {
    return null
  }
  return `Deleted ${folder} (${paths.length} files)`
}

/**
 * How many files the draft changes: their text, their path, made or deleted. `latest` is the latest
 * version's text of each file, by ID.
 */
export function filesChanged(
  files: ReadonlyArray<{ file: string; content: string; made: string | null; was: string | null }>,
  deleted: number,
  latest: ReadonlyMap<string, string>,
): number {
  return files.filter((f) => f.made !== null || f.was !== null || latest.get(f.file) !== f.content).length + deleted
}
