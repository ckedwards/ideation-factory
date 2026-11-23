// The idea's draft, on the files page or in the focus view: one per idea, on
// its latest version, shared by everyone who can edit it, and kept by the
// server. While it's open, its files are live documents on the draft's socket
// (draft-live.ts): what's typed goes to everyone editing as it's typed, merged
// with theirs; the idea's socket's draft event keeps the list of changes
// current. Committing makes one version, and the editor stays open on it. The
// files page edits the file it shows; the focus view, every file at once, all
// of them stored before Commit, Preview or leaving.
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ApiError, type Operations, type Output } from '@ideaf/api'
import { type DraftChange, markdownTree, parseMarkdown, plainLine } from '@ideaf/core'
import { type Person, Redline, renderMermaid } from '@ideaf/ui'
import type { PageMark } from '@ideaf/ui/editor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../../../api.ts'
import { accessToken } from '../../../../../session.ts'
import { DraftLive } from './draft-live.ts'
import { type CommentOutcomeRow, EditActions, EditPanel, type EditPanelProps } from './EditPanel.tsx'
import { IdeaMode } from './IdeaFrame.tsx'
import { DraftEditor } from './DraftEditor.tsx'
import { blockRange, headingOffset, toSource } from './anchors.ts'
import { draftQuery, filesQuery, ideaQuery } from './queries.ts'
import type { DraftVersion } from './VersionList.tsx'
import type { FileView, Placement, Thread } from './view.ts'

export type Draft = Output<Operations['getDraft']>

export interface UseEditingArgs {
  idea: string
  /** Over the editor's text: the file's line. */
  lead?: ReactNode
  draft: Draft | undefined
  /** Whether the draft is open for editing on the page. */
  open: boolean
  setOpen: (open: boolean) => void
  /** The file shown, and the latest version's files (what the preview compares with). */
  file: string
  /** The file as the page shows it (the latest version): where a comment the draft doesn't place is. */
  shownFile: FileView
  latestFiles: Array<{ file: string; content: string }>
  threads: Thread[]
  people: Map<string, Person>
  onNote: (message: string) => void
  /** Committed as this version. */
  onCommitted: (version: number) => void
}

/** What the editor shows of the comments: those the panel shows, the one that's active, and a mark clicked. */
export interface EditingView {
  shown: Array<{ id: string; resolved: boolean }>
  active: string | null
  onSelect: (id: string) => void
}

export interface Editing {
  /** The page, marked with the comments the panel shows. */
  document: (view: EditingView) => ReactNode
  /** Any file of the draft, edited (or, previewing, compared): a sheet of the focus view. */
  sheet: (file: string) => ReactNode
  /** The draft's changes and what committing does to the comments, with Undo (EditPanel). */
  panel: ReactNode
  /** Commit, Preview, Discard and Close editor (EditActions). */
  actions: ReactNode
  /** "Editing the draft, on v3". */
  label: string
  /** Everything typed saved, then the editor closed; false if something couldn't be saved (it says why). */
  close: () => Promise<boolean>
  /** The draft, heading the list of versions: its changes, and comparing it with any version. */
  draft: DraftVersion
  bar: ReactNode
  /** Where each comment is in the draft, as the page places them. */
  places: Map<string, Placement>
}

export function useEditing(args: UseEditingArgs): Editing | null {
  const { idea, draft } = args
  const queryClient = useQueryClient()
  // the version the draft's compared with, in place of the editor; null while it's edited
  const [comparedWith, setComparedWith] = useState<number | null>(null)
  const previewing = comparedWith !== null
  const setPreviewing = (on: boolean) => setComparedWith(on && draft ? draft.version : null)
  // an earlier version's files, to compare with (the latest's are the page's own)
  const earlier = useQuery({
    ...filesQuery(idea, comparedWith ?? 0),
    enabled: comparedWith !== null && draft !== undefined && comparedWith !== draft.version,
  })
  const [committing, setCommitting] = useState(false)
  // the files typed in and not saved yet
  const [unsavedFiles, setUnsavedFiles] = useState<ReadonlySet<string>>(new Set())
  // each file's save of whatever's unsaved in it: the actions wait for all of them
  const flushes = useRef(new Map<string, { current: (() => Promise<boolean>) | null }>())
  // the draft's live socket, while the editor's open
  const [live, setLive] = useState<DraftLive | null>(null)
  const notes = useRef(args.onNote)
  notes.current = args.onNote
  useEffect(() => {
    if (!args.open) {
      return
    }
    const connection = new DraftLive(idea, {
      open: (path) => new WebSocket(`${location.origin.replace(/^http/, 'ws')}${path}`),
      token: accessToken,
      // a version made: the bar moves on to it, and the list of changes is read again
      onVersion: () => {
        void queryClient.invalidateQueries({ queryKey: ideaQuery(idea).queryKey, exact: true })
        void queryClient.invalidateQueries({ queryKey: draftQuery(idea).queryKey, exact: true })
      },
      onClosed: (why) =>
        notes.current(
          why === 'forbidden'
            ? 'You can no longer edit this idea. What you typed is still on the page, to copy.'
            : 'This idea is gone, or you can no longer see it.',
        ),
      onRefused: (_file, message) => notes.current(`That didn’t save: ${message}`),
    })
    setLive(connection)
    return () => {
      connection.stop()
      setLive(null)
    }
  }, [idea, args.open, queryClient])
  if (!args.open || !draft) {
    return null
  }
  const unsaved = unsavedFiles.size > 0
  /** A file's save, for its editor to set: the same object each time, so the editor keeps it. */
  const flushFor = (id: string) => {
    let ref = flushes.current.get(id)
    if (!ref) {
      ref = { current: null }
      flushes.current.set(id, ref)
    }
    return ref
  }
  const unsavedIn = (id: string) => (now: boolean) =>
    setUnsavedFiles((was) => {
      if (was.has(id) === now) {
        return was
      }
      const next = new Set(was)
      if (now) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })

  const reread = async () => {
    await queryClient.invalidateQueries({ queryKey: draftQuery(idea).queryKey, exact: true })
    return queryClient.getQueryData(draftQuery(idea).queryKey)
  }
  const failed = (error: unknown) => {
    const problem = error instanceof ApiError ? (error.details as { problem?: string } | undefined)?.problem : undefined
    args.onNote(
      problem
        ? `Someone changed that meanwhile (${problem}): here’s the draft as it is now.`
        : `That didn’t work: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const file = draft.files.find((f) => f.file === args.file) ?? draft.files[0]
  const placed = file ? placeComments(draft, file, args.shownFile, args.threads) : { places: new Map(), marks: [] }
  /** What's typed, in every file, saved first; false if something couldn't be (the page says why). */
  const saved = async () => {
    for (const ref of flushes.current.values()) {
      if (ref.current && !(await ref.current())) {
        return false
      }
    }
    return true
  }

  const commit = async () => {
    setCommitting(true)
    try {
      if (!(await saved())) {
        return
      }
      // what was typed may change nothing in the file (an empty line has no Markdown)
      const now = queryClient.getQueryData(draftQuery(idea).queryKey)
      if (now && now.changes.length === 0) {
        args.onNote('Nothing to commit: the file reads as it did.')
        return
      }
      const done = await api.commitDraft({ idea })
      args.onCommitted(done.version)
      // the editor stays open: what's typed from now on is the next version's
      setPreviewing(false)
    } catch (error) {
      failed(error)
    } finally {
      setCommitting(false)
      void reread()
    }
  }

  const compareFiles = comparedWith === draft.version ? args.latestFiles : (earlier.data?.files ?? [])
  /** A file of the draft compared with the version chosen. */
  const compared = (id: string) => {
    const before = compareFiles.find((f) => f.file === id)?.content ?? ''
    const after = draft.files.find((f) => f.file === id)?.content ?? ''
    return (
      <Redline
        base={{ source: before, tree: markdownTree(before) }}
        current={{ source: after, tree: markdownTree(after) }}
        renderCode={renderMermaid}
      />
    )
  }
  const close = async () => {
    if (!(await saved())) {
      return false
    }
    setPreviewing(false)
    args.setOpen(false)
    return true
  }
  // the panel's and the bar's: the same draft, and the same ways of acting on it
  const panelProps: EditPanelProps = {
    version: draft.version,
    changes: draft.changes.map((c) => ({
      key: c.key,
      label: describe(c.change),
      by: args.people.get(c.by.user)?.name ?? 'someone',
      problem: c.problem,
    })),
    outcomes: draft.comments.map((o): CommentOutcomeRow => {
      const thread = args.threads.find((t) => t.id === o.id)
      const anchor = thread?.anchor
      return {
        id: o.id,
        state: o.state,
        label: anchor?.kind === 'text' ? `“${anchor.quote}”` : thread ? excerpt(thread.body) : o.id,
      }
    }),
    previewing,
    committing,
    unsaved,
    onUndo: (key) =>
      void api
        .undoDraftChange({ idea, key })
        .catch(failed)
        .finally(() => void reread()),
    onPreview: (on) => void saved().then((ok) => ok && setPreviewing(on)),
    onCommit: () => void commit(),
    onDiscard: () =>
      void api
        .discardDraft({ idea })
        .then(() => {
          args.onNote('The draft is discarded.')
          setPreviewing(false)
        }, failed)
        .finally(() => void reread()),
    onClose: () => void close(),
  }
  const label = `Editing the draft, on v${draft.version}`
  return {
    document: (view) =>
      previewing ? (
        <>
          <p className="draft-editor-file">
            {file?.path} <span className="draft-editor-compared">· the draft compared with v{comparedWith}</span>
          </p>
          {file && compared(file.file)}
        </>
      ) : (
        file &&
        (live ? (
          <DraftEditor
            key={file.file}
            idea={idea}
            draft={draft}
            file={file.file}
            live={live}
            reread={reread}
            flush={flushFor(file.file)}
            onUnsaved={unsavedIn(file.file)}
            marks={placed.marks}
            view={view}
            {...(args.lead ? { lead: args.lead } : {})}
          />
        ) : (
          <p className="draft-editor-opening">Opening…</p>
        ))
      ),
    // the focus view's: every file, without its comments (the panel's in their place), its sheet's head
    // naming it
    sheet: (id) =>
      previewing ? (
        compared(id)
      ) : draft.files.some((f) => f.file === id) && live ? (
        <DraftEditor
          key={id}
          idea={idea}
          draft={draft}
          file={id}
          live={live}
          reread={reread}
          flush={flushFor(id)}
          onUnsaved={unsavedIn(id)}
          bare
        />
      ) : null,
    panel: <EditPanel {...panelProps} />,
    actions: <EditActions {...panelProps} />,
    label,
    close,
    draft: {
      on: draft.version,
      changes: draft.changes.length,
      by: [...new Set(draft.changes.map((c) => args.people.get(c.by.user)?.name ?? 'someone'))],
      open: true,
      comparedWith,
      onCompare: (version) => void saved().then((ok) => ok && setComparedWith(version)),
      detail: <EditPanel {...panelProps} />,
    },
    places: placed.places,
    // the editor's words and actions in the idea's bar, while it's open
    bar: <IdeaMode label={label} actions={<EditActions {...panelProps} />} />,
  }
}

/**
 * Where each comment on the file is in the draft, as the page places them, and its marks for the
 * editor: a mark for each block its text is in, or its heading. The draft places every comment it
 * keeps; a pending one (in someone's review) is where it is in the latest version, whose blocks the
 * draft knows by the same IDs.
 */
function placeComments(
  draft: Draft,
  file: Draft['files'][number],
  shownFile: FileView,
  threads: Thread[],
): { places: Map<string, Placement>; marks: PageMark[] } {
  const places = new Map<string, Placement>()
  const marks: PageMark[] = []
  const at = (id: string, anchor: Thread['anchor'], source: string, ids: readonly string[]) => {
    if (!anchor || anchor.kind === 'idea' || anchor.file !== file.file) {
      return
    }
    if (anchor.kind === 'file') {
      places.set(id, { kind: 'file' })
      return
    }
    if (anchor.kind === 'section') {
      const heading = headingOffset(source, ids, anchor.section)
      places.set(id, heading === null ? { kind: 'file' } : { kind: 'section', heading })
      if (heading !== null) {
        marks.push({ id, heading: anchor.section })
      }
      return
    }
    if (anchor.kind === 'block') {
      // where the draft has its block, marked there by its corners
      const range = blockRange(source, ids, anchor.block)
      places.set(id, range ? { kind: 'block', ...range } : { kind: 'outdated' })
      if (range) {
        marks.push({ id, whole: anchor.block })
      }
      return
    }
    const range = toSource(source, anchor)
    if (!range) {
      places.set(id, { kind: 'outdated' })
      return
    }
    places.set(id, { kind: 'text', ...range })
    const parsed = parseMarkdown(source)
    parsed.units.forEach((unit, i) => {
      const from = Math.max(anchor.start, unit.plainStart)
      const to = Math.min(anchor.end, unit.plainEnd)
      const block = ids[i]
      if (to > from && block) {
        marks.push({
          id,
          block,
          from: from - unit.plainStart,
          to: to - unit.plainStart,
          quote: parsed.plain.text.slice(from, to),
        })
      }
    })
  }
  const ids = file.units.map((u) => u.id)
  for (const outcome of draft.comments) {
    if (outcome.state === 'outdated' || !outcome.anchor) {
      places.set(outcome.id, { kind: 'outdated' })
    } else {
      at(outcome.id, outcome.anchor, file.content, ids)
    }
  }
  const kept = new Set(draft.comments.map((o) => o.id))
  for (const thread of threads) {
    if (!kept.has(thread.id) && thread.state !== 'outdated' && shownFile.id === file.file) {
      at(thread.id, thread.anchor, shownFile.source, shownFile.unitIds)
    }
  }
  return { places, marks }
}

/** A change as the list of changes names it. */
function describe(change: DraftChange): string {
  const heading = (source: string) => /^\s*#{1,6}\s/.test(source)
  switch (change.kind) {
    case 'insert':
      return EMPTY.test(change.markdown) ? `Added ${empty(change.markdown)}` : `Added “${excerpt(change.markdown)}”`
    case 'suggestion':
      return `Suggestion ${change.comment}: “${excerpt(change.old)}” → “${excerpt(change.new)}”`
    case 'delete':
      if (EMPTY.test(change.was)) {
        return `Deleted ${empty(change.was)}`
      }
      return heading(change.was) ? `Deleted the section “${title(change.was)}”` : `Deleted “${excerpt(change.was)}”`
    case 'move':
      if (EMPTY.test(change.was)) {
        return `Moved ${empty(change.was)}`
      }
      return heading(change.was) ? `Moved the section “${title(change.was)}”` : `Moved “${excerpt(change.was)}”`
    case 'move-text':
      return `Moved “${excerpt(change.old)}”`
    case 'edit':
      return heading(change.was)
        ? `Renamed “${title(change.was)}” to “${title(change.source)}”`
        : `Edited “${excerpt(change.source)}”`
  }
}

/** Some Markdown as it reads, cut short. */
function excerpt(markdown: string): string {
  const text = plainLine(markdown)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/** A block with no words yet: a bullet, number, heading or quote marker alone, or an empty line. */
const EMPTY = /^\s*([-*+]|\d+[.)]|#{1,6}|>|<br\s*\/?>)\s*$/i

/** A block with no words yet, by its kind: an empty bullet, heading or quote. */
function empty(markdown: string): string {
  const line = markdown.trim()
  if (line.startsWith('<')) {
    return 'an empty line'
  }
  return line.startsWith('#') ? 'an empty heading' : line.startsWith('>') ? 'an empty quote' : 'an empty list item'
}

/** A heading's title: its source without the #s. */
function title(source: string): string {
  return source
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '')
    .trim()
}
