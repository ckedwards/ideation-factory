// PROTOTYPE: derives everything the idea page needs to render the current file.
import { useMemo } from 'react'
import { target, type Comment } from './data'
import { useStore } from './store'
import {
  changedSections,
  fileChange,
  headings,
  htmlText,
  placeComment,
  renderMarkdown,
  renderRedline,
  useIdeaSearch,
  type FileChange,
  type Placement,
} from './lib'

export type PlacedComment = Comment & { placement: Placement }
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
  const baseLabel = compare === 'main' ? 'main' : compare ? `v${compare}` : undefined

  // Section rails show what changed vs the target branch. A file that is new
  // relative to the target gets no rails (it's all new; the file list says so).
  const changed = useMemo(
    () => (target[file] === undefined ? new Set<string>() : changedSections(target[file], src)),
    [file, src],
  )

  const html = useMemo(() => renderMarkdown(src, file, files), [src, file, files.join()])
  const redline = useMemo(
    () => (baseFiles ? renderRedline(baseFiles[file] ?? '', src, file, files) : null),
    [baseFiles, src, file, files.join()],
  )
  const text = useMemo(() => htmlText(html), [html])
  const heads = useMemo(() => headings(src), [src])

  const comments: PlacedComment[] = state.comments
    .filter((c) => c.file === file && c.version <= version.n)
    .map((c) => ({ ...c, placement: placeComment(c, src, text, heads) }))

  // Per-file entries vs the compare base (default: the target branch), with
  // open-comment counts.
  const entryBase = baseFiles ?? target
  const entries: FileEntry[] = files.map((path) => ({
    path,
    change: fileChange(entryBase[path], version.files[path]),
    open: state.comments.filter((c) => c.file === path && c.status === 'unresolved' && c.version <= version.n).length,
  }))

  // Lost comments across every file in this version.
  const allLost = state.comments.filter((c) => {
    if (c.version > version.n) return false
    const s = version.files[c.file]
    if (c.file !== file) {
      if (s === undefined) return true
      if (c.anchor.type === 'file') return false
      if (c.anchor.type === 'section') return !headings(s).includes(c.anchor.section)
      return !htmlText(renderMarkdown(s, c.file, files)).includes(c.anchor.quote)
    }
    return placeComment(c, src, text, heads) === 'lost'
  })

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
    allLost,
  }
}
