// The idea's draft, on the files page or in the focus view: one per idea, on
// its latest version, shared by everyone who can edit it, and kept by the
// server. While it's open, its files are live documents on the draft's socket
// (draft-live.ts): what's typed goes to everyone editing as it's typed, merged
// with theirs; the idea's socket's draft event keeps the list of changes
// current. Committing makes one version, and the editor stays open on it. The
// files page edits the file it shows; the focus view, every file at once, all
// of them stored before Commit, Preview or leaving.
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError, type Operations, type Output } from '@ideaf/api'
import { type DraftChange, markdownTree, parseMarkdown, plainLine } from '@ideaf/core'
import { type Person, PresenceStack, Redline, renderMermaid } from '@ideaf/ui'
import type { PageMark } from '@ideaf/ui/editor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../../../api.ts'
import { accessToken } from '../../../../../session.ts'
import { DraftLive } from './draft-live.ts'
import {
  type CommentOutcomeRow,
  type Contributor,
  EditActions,
  type EditPanelProps,
  type Together,
} from './EditPanel.tsx'
import { IdeaMode } from './IdeaFrame.tsx'
import { DraftEditor } from './DraftEditor.tsx'
import { blockRange, headingOffset, toSource } from './anchors.ts'
import { usePeople } from './shared.tsx'
import { draftQuery, filesQuery, ideaQuery, restorePointQuery, restorePointsQuery } from './queries.ts'
import type { DraftVersion } from './VersionList.tsx'
import { type EarlierDraft, EarlierDraftBand, EarlierDraftDialogs } from './EarlierDrafts.tsx'
import { type FileView, personOf, type Placement, type Thread } from './view.ts'

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
  /** Who's signed in: their other windows in the draft say so. */
  me: string
  /** The idea's owner, who can delete any earlier draft. */
  owner?: string
  /** Show a file of the draft that isn't shown (going to someone in it). */
  onShowFile?: (file: string) => void
  onNote: (message: string) => void
  /** Committed as this version. */
  onCommitted: (version: number) => void
  /** Someone else committed the draft as this version (named): what's typed now is the next one's. */
  onTheirCommit?: (version: number, by: string) => void
  /** A version made around the draft (by whom, named) overwrote some of its changes: a force push. */
  onOverwritten?: (version: number, by: string, changes: number) => void
  /**
   * The draft was discarded, by someone else (named) or here (null), and `restore` brings it back
   * from the restore point the discard kept (null: it was empty, so there's nothing to bring back).
   */
  onDiscarded?: (by: string | null, restore: (() => void) | null) => void
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
  /** The draft's changes (a dialog: EditPanel), Commit, Preview, Discard and Close editor (EditActions). */
  actions: ReactNode
  /** "Editing the draft, on v3". */
  label: string
  /** The faces of who else is in the draft, to go to each (PresenceStack); null when nobody is. */
  people: ReactNode
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
  // an earlier draft (restore point) shown in place of the editor, and restoring or deleting one, asked first
  const [opened, setOpened] = useState<number | null>(null)
  const [asking, setAsking] = useState<{ kind: 'restore' | 'delete'; point: number } | null>(null)
  const points = useQuery({ ...restorePointsQuery(idea), enabled: args.open && draft !== undefined })
  const shownPoint = useQuery({ ...restorePointQuery(idea, opened ?? 0), enabled: opened !== null })
  const [committing, setCommitting] = useState(false)
  // the files typed in and not saved yet
  const [unsavedFiles, setUnsavedFiles] = useState<ReadonlySet<string>>(new Set())
  // each file's save of whatever's unsaved in it: the actions wait for all of them
  const flushes = useRef(new Map<string, { current: (() => Promise<boolean>) | null }>())
  // the draft's live socket, while the editor's open
  const [live, setLive] = useState<DraftLive | null>(null)
  const notes = useRef(args.onNote)
  notes.current = args.onNote
  const theirCommit = useRef(args.onTheirCommit)
  theirCommit.current = args.onTheirCommit
  const overwritten = useRef(args.onOverwritten)
  overwritten.current = args.onOverwritten
  const discarded = useRef(args.onDiscarded)
  discarded.current = args.onDiscarded
  // a discarded draft brought back, for everyone, from the restore point its discard kept
  const restoring = (point: number | null) =>
    point === null
      ? null
      : () =>
          void api.restoreDraft({ idea, point }).then(
            () => {
              notes.current('The draft is restored.')
              void queryClient.invalidateQueries({ queryKey: draftQuery(idea).queryKey, exact: true })
            },
            (error: unknown) =>
              notes.current(
                `The draft couldn’t be restored: ${error instanceof Error ? error.message : String(error)}`,
              ),
          )
  const peopleRef = useRef(args.people)
  peopleRef.current = args.people
  useEffect(() => {
    if (!args.open) {
      return
    }
    const connection = new DraftLive(idea, {
      open: (path) => new WebSocket(`${location.origin.replace(/^http/, 'ws')}${path}`),
      token: accessToken,
      // a version made: the bar moves on to it, and the list of changes is read again; someone
      // else committing it is named (your own commit says so itself)
      onVersion: (version, by, committed, overwrote) => {
        void queryClient.invalidateQueries({ queryKey: ideaQuery(idea).queryKey, exact: true })
        void queryClient.invalidateQueries({ queryKey: draftQuery(idea).queryKey, exact: true })
        if (committed && by.user !== args.me) {
          theirCommit.current?.(version, personOf(by, peopleRef.current).name)
        }
        // overwriting the draft is never this window's doing: everyone's told, its maker's people too
        if (overwrote > 0) {
          overwritten.current?.(version, personOf(by, peopleRef.current).name, overwrote)
        }
      },
      onDiscarded: (by, point) => {
        void queryClient.invalidateQueries({ queryKey: draftQuery(idea).queryKey, exact: true })
        if (by.user !== args.me) {
          const name = personOf(by, peopleRef.current).name
          if (discarded.current) {
            discarded.current(name, restoring(point))
          } else {
            notes.current(`${name} discarded the draft.`)
          }
        }
      },
      onRestored: (by) => {
        void queryClient.invalidateQueries({ queryKey: draftQuery(idea).queryKey, exact: true })
        if (by.user !== args.me) {
          notes.current(`${personOf(by, peopleRef.current).name} restored the draft.`)
        }
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
  }, [idea, args.open, args.me, queryClient])
  // who else is in the draft, named, and their carets named the same
  useSyncExternalStore(
    (changed) => live?.subscribe(changed) ?? (() => {}),
    () => live?.revision() ?? 0,
  )
  const present = live?.people() ?? []
  const names = usePeople(present.map((p) => p.user))
  const namesKey = present.map((p) => `${p.user}=${names.get(p.user)?.name ?? ''}`).join('\n')
  useEffect(() => {
    // your other window's caret is just "You": its flag is small, between the lines
    live?.setNames((user) => (user === args.me ? 'You' : (names.get(user)?.name ?? 'Someone')))
    // by the names, not the map they came in
  }, [live, namesKey, args.me])
  const goingTo = useRef(0)
  if (!args.open || !draft) {
    return null
  }
  /** Scrolls to where a window's caret is: in a file shown, or once the file it's in is. */
  const goTo = (window: string) => {
    const person = live?.people().find((p) => p.window === window)
    const at = person?.at
    if (!at) {
      args.onNote(`${names.get(person?.user ?? '')?.name ?? 'They'} isn’t in a file right now.`)
      return
    }
    const find = () => document.querySelector(`.live-caret[data-presence="${CSS.escape(window)}"]`)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const show = (caret: Element) => caret.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    const now = find()
    if (now) {
      show(now)
      return
    }
    args.onShowFile?.(at.file)
    // the file's editor opens, and draws the caret: a moment
    const going = ++goingTo.current
    const until = Date.now() + 3000
    const look = () => {
      const caret = find()
      if (caret) {
        show(caret)
      } else if (going === goingTo.current && Date.now() < until) {
        requestAnimationFrame(look)
      }
    }
    requestAnimationFrame(look)
  }
  const people =
    present.length > 0 ? (
      <PresenceStack
        present={present.map((p) => ({
          key: p.window,
          person: names.get(p.user) ?? { id: p.user, name: 'Someone' },
          color: p.color,
          ...(p.user === args.me ? { note: 'other window' } : {}),
        }))}
        onGo={goTo}
      />
    ) : null
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
  // the earlier drafts, named as the list names them
  const named = (c: { user: string; bot: string | null }) => {
    const name = args.people.get(c.user)?.name ?? 'someone'
    return c.bot ? `${c.bot} for ${name}` : name
  }
  const earlierDrafts: EarlierDraft[] = (points.data?.points ?? []).map((p) => {
    const by = p.by ? named(p.by) : 'someone'
    const reason = {
      quiet: null,
      left: null,
      agent: `Before ${by} changed it`,
      discard: `Before ${by} discarded it`,
      overwrite: `Before ${by}’s version overwrote it`,
      restore: `Before ${by} restored an earlier one`,
    }[p.why]
    return {
      point: p.point,
      at: p.at,
      reason,
      who: [...new Set(p.who.map(named))],
      changes: p.changes,
      first: p.first ? describe(p.first) : null,
      more: p.more,
      undone: p.undone,
      on: p.version < draft.version ? p.version : null,
      kept: p.kept,
      canDelete: args.owner === args.me || p.who.some((w) => w.user === args.me),
    }
  })
  const shownEarlier = earlierDrafts.find((d) => d.point === opened) ?? null
  const askingAbout = asking ? earlierDrafts.find((d) => d.point === asking.point) : undefined
  /** A file of the draft as the earlier draft shown would make it, marked against the draft now. */
  const pointCompared = (id: string) => {
    if (!shownPoint.data) {
      return <p className="draft-editor-opening">Opening…</p>
    }
    const now = draft.files.find((f) => f.file === id)?.content ?? ''
    const then = shownPoint.data.files.find((f) => f.file === id)?.content ?? ''
    return (
      <Redline
        base={{ source: now, tree: markdownTree(now) }}
        current={{ source: then, tree: markdownTree(then) }}
        renderCode={renderMermaid}
      />
    )
  }
  const rereadPoints = () =>
    void queryClient.invalidateQueries({ queryKey: restorePointsQuery(idea).queryKey, exact: true })
  /** What was asked, confirmed: an earlier draft restored for everyone, or deleted. */
  const confirmed = () => {
    if (!asking) {
      return
    }
    const { kind, point } = asking
    setAsking(null)
    if (kind === 'restore') {
      void saved()
        .then((ok) =>
          ok ? api.restoreDraft({ idea, point }) : Promise.reject(new Error('what you typed isn’t saved')),
        )
        .then(() => {
          setOpened(null)
          args.onNote('The draft is restored. The draft as it was is kept as an earlier draft.')
        }, failed)
        .finally(() => {
          void reread()
          rereadPoints()
        })
    } else {
      void api
        .deleteRestorePoint({ idea, point })
        .then(() => {
          setOpened((was) => (was === point ? null : was))
          args.onNote('The earlier draft is deleted.')
        }, failed)
        .finally(rereadPoints)
    }
  }
  const close = async () => {
    if (!(await saved())) {
      return false
    }
    setOpened(null)
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
      authors: c.authors.map((a) => personOf(a, args.people)),
      problem: c.problem,
    })),
    together: together(draft, args.latestFiles, present, args.me, args.people),
    onConfirming: () => void reread(),
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
    onPreview: (on) =>
      void saved().then((ok) => {
        if (ok) {
          setOpened(null)
          setPreviewing(on)
        }
      }),
    onCommit: () => void commit(),
    onDiscard: () =>
      void api
        .discardDraft({ idea })
        .then(({ point }) => {
          if (args.onDiscarded) {
            args.onDiscarded(null, restoring(point))
          } else {
            args.onNote('The draft is discarded.')
          }
          setPreviewing(false)
        }, failed)
        .finally(() => void reread()),
    onClose: () => void close(),
  }
  const label = `Editing the draft, on v${draft.version}`
  const band = shownEarlier && (
    <EarlierDraftBand
      draft={shownEarlier}
      held={shownPoint.data?.held ?? 0}
      onBack={() => setOpened(null)}
      onRestore={() => setAsking({ kind: 'restore', point: shownEarlier.point })}
    />
  )
  return {
    document: (view) =>
      shownEarlier ? (
        <>
          {band}
          <p className="draft-editor-file">{file?.path}</p>
          {file && pointCompared(file.file)}
        </>
      ) : previewing ? (
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
      shownEarlier ? (
        pointCompared(id)
      ) : previewing ? (
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
    actions: <EditActions {...panelProps} />,
    label,
    people,
    close,
    draft: {
      on: draft.version,
      changes: draft.changes.length,
      by: [...new Set(draft.changes.map((c) => args.people.get(c.by.user)?.name ?? 'someone'))],
      open: true,
      comparedWith,
      onCompare: (version) =>
        void saved().then((ok) => {
          if (ok) {
            setOpened(null)
            setComparedWith(version)
          }
        }),
      earlier: {
        drafts: earlierDrafts,
        opened,
        onOpen: (point) =>
          void saved().then((ok) => {
            if (ok) {
              setComparedWith(null)
              setOpened(point)
            }
          }),
        onRestore: (point) => setAsking({ kind: 'restore', point }),
        onDelete: (point) => setAsking({ kind: 'delete', point }),
      },
    },
    places: placed.places,
    // the editor's words and actions in the idea's bar, while it's open
    bar: (
      <>
        <IdeaMode people={people} label={label} actions={<EditActions {...panelProps} />} />
        <EarlierDraftDialogs
          asking={asking && askingAbout ? { kind: asking.kind, draft: askingAbout } : null}
          changes={draft.changes.length}
          onCancel={() => setAsking(null)}
          onConfirm={confirmed}
        />
      </>
    ),
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
    case 'create-file':
      return `Added ${change.path}`
    case 'rename-file':
      return `Renamed ${change.was} to ${change.path}`
    case 'delete-file':
      return `Deleted ${change.file}`
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

/**
 * The draft as committing takes it, when it isn't only yours (the commit dialog): everyone who typed
 * in its changes, with how many, other people first and you last, and where each other person is
 * typing now. Null when nobody else is in the draft or has changes in it.
 */
function together(
  draft: Draft,
  latestFiles: Array<{ file: string; content: string }>,
  present: Array<{ user: string }>,
  me: string,
  people: ReadonlyMap<string, Person>,
): Together | null {
  const byKey = new Map<string, Contributor>()
  for (const change of draft.changes) {
    for (const author of change.authors) {
      const key = `${author.user}/${author.bot ?? ''}`
      const had = byKey.get(key)
      if (had) {
        had.changes++
      } else {
        const you = author.user === me && author.purpose === 'me'
        const typing = author.purpose === 'me' && !you ? draft.typing.find((t) => t.user === author.user) : undefined
        byKey.set(key, {
          key,
          person: personOf(author, people),
          changes: 1,
          typingIn: typing ? (typing.heading ?? '') : null,
          you,
        })
      }
    }
  }
  const all = [...byKey.values()]
  const others = all.filter((c) => !c.you)
  if (others.length === 0 && !present.some((p) => p.user !== me)) {
    return null
  }
  const latest = new Map(latestFiles.map((f) => [f.file, f.content]))
  const drafted = new Set(draft.files.map((f) => f.file))
  const files =
    draft.files.filter((f) => latest.get(f.file) !== f.content).length +
    [...latest.keys()].filter((f) => !drafted.has(f)).length
  return { changes: draft.changes.length, files, people: [...others, ...all.filter((c) => c.you)] }
}
