// PROTOTYPE: derives everything the idea page needs to render the current file.
import { useMemo } from 'react'
import { target, type Comment } from './data'
import { useStore } from './store'
import {
  changedSections,
  fileChange,
  headings,
  htmlText,
  lastSeenIn,
  placeComment,
  renderMarkdown,
  renderRedline,
  useIdeaSearch,
  type FileChange,
  type Placement,
} from './lib'

// lastSeen: for an outdated comment, the newest version where its text still was
export type PlacedComment = Comment & { placement: Placement; lastSeen?: number }
export type FileEntry = { path: string; change: FileChange; open: number }

export function useIdeaView() {
  const { state } = useStore()
  const [search, setSearch] = useIdeaSearch()
  const latest = state.versions[state.versions.length - 1]
  const version = state.versions.find((v) => v.n === search.v) ?? latest
  const isLatest = version.n === latest.n

  const files = Object.keys(version.files).sort()
  const file = version.files[search.file] !== undefined ? search.file : files.find((f) => f.endsWith('README.md') && f.includes('offline')) ?? files[0]
  const src = version.files[file]

  // "compare" is either a version number or "main" (the target branch).
  const compare = search.compare
  const baseFiles =
    compare === 'main' ? target : compare ? state.versions.find((v) => String(v.n) === compare)?.files : undefined
  // the main snapshot has no uploaded images in this prototype
  const baseMedia = compare && compare !== 'main' ? state.versions.find((v) => String(v.n) === compare)?.media : undefined
  const baseLabel = compare === 'main' ? 'main' : compare ? `v${compare}` : undefined

  // Section rails show what changed vs the target branch. A file that is new
  // relative to the target gets no rails (it's all new; the file list says so).
  const changed = useMemo(
    () => (target[file] === undefined ? new Set<string>() : changedSections(target[file], src)),
    [file, src],
  )

  const html = useMemo(() => renderMarkdown(src, file, files, version.media, state.externalImages), [src, file, files.join(), version, state.externalImages])
  const redline = useMemo(
    () => (baseFiles ? renderRedline(baseFiles[file] ?? '', src, file, files, baseMedia, version.media, state.externalImages) : null),
    [baseFiles, src, file, files.join(), version, baseMedia, state.externalImages],
  )
  const text = useMemo(() => htmlText(html), [html])
  const heads = useMemo(() => headings(src), [src])

  const comments: PlacedComment[] = state.comments
    .filter((c) => c.file === file && c.version <= version.n)
    .map((c) => {
      const placement = placeComment(c, src, text, heads)
      return { ...c, placement, lastSeen: placement === 'outdated' ? lastSeenIn(c, state.versions, version.n) : undefined }
    })

  // Per-file entries vs the compare base (default: the target branch), with
  // open-comment counts.
  const entryBase = baseFiles ?? target
  const entries: FileEntry[] = files.map((path) => ({
    path,
    change: fileChange(entryBase[path], version.files[path]),
    open: state.comments.filter((c) => c.file === path && c.status === 'unresolved' && c.version <= version.n).length,
  }))

  return {
    state,
    search,
    setSearch,
    latest,
    version,
    isLatest,
    files,
    file,
    src,
    html,
    redline,
    baseLabel,
    changed,
    comments,
    entries,
  }
}
