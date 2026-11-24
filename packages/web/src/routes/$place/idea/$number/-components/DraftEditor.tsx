// A file of the idea's draft as one page in the editor (ui's MarkdownEditor, its page flavor), live
// (docs/handoff-live-editing.md, step 3): the file is a live document on the draft's socket
// (draft-live.ts), and what's typed on the rich side goes to the idea's actor as it's typed, merged
// with everyone else's, who see it as it comes. The saving line says where it is: Saved once the
// server has stored it, Saving… while some is on its way (after half a second, so it doesn't flicker),
// Offline while the connection's dropped (typing is kept, and sent once it's back).
//
// The Markdown side isn't live: it's saved as the draft always was, block by block, after a pause in
// typing and before anything that reads the draft (flush), each block checked against what it read
// when typing started; one someone changed meanwhile is refused as outdated, and the person picks
// theirs or their own. Switching to it waits for what's typed to be stored; switching back saves it,
// and the rich side opens the live document again, with it in.
//
// Away too long for the server to have kept what was missed, the page is compared with the draft and
// saved the same way, block by block, then opened again from the server (until step 8 has its own).
// Edit access gone, the page turns read-only, with what was typed still there to copy. While the draft
// is full (its limit of windows, the server's limits.draft.editors), it's read-only and still live,
// until someone leaves.
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError } from '@ideaf/api'
import { draftChanges, type Idea } from '@ideaf/core'
import { Button } from '@ideaf/ui'
import { MarkdownEditor, type MarkdownEditorHandle, type PageMark } from '@ideaf/ui/editor'
import type { LiveDoc, LiveStatus } from '@ideaf/ui/editor/live'
import { useBlocker } from '@tanstack/react-router'
import { api } from '../../../../../api.ts'
import type { DraftLive } from './draft-live.ts'
import type { Draft, EditingView } from './editing.tsx'
import './DraftEditor.css'

/** On the Markdown side: how long typing stops before what's typed is saved. */
const PAUSE_MS = 1000
/** How long something's on its way before the line says Saving…. */
const SAVING_AFTER_MS = 500

/** A save by block (the Markdown side, or after a long gap): done, under way, refused as outdated, or failed. */
type Status = 'saved' | 'saving' | { problem: string } | { outdated: string }

export interface DraftEditorProps {
  idea: string
  draft: Draft
  /** The file shown (its ID). */
  file: string
  /** The draft's live socket: the file's live document comes from it. */
  live: DraftLive
  /** The draft read again: as it now is. */
  reread: () => Promise<Draft | undefined>
  /** Set to a save of whatever's unsaved: the bar's Commit, Preview and Close editor wait for it. */
  flush: RefObject<(() => Promise<boolean>) | null>
  /** Whether something's typed and not saved yet, each time that changes. */
  onUnsaved?: (unsaved: boolean) => void
  /** The file's comments, where the draft has them. */
  marks?: PageMark[]
  /** Which of them the panel shows, the one that's active, and a mark clicked. */
  view?: EditingView
  /** Over the text: the file's line; its path alone without one. */
  lead?: ReactNode
  /** Nothing over the text: what it's in names the file (a sheet of the focus view). */
  bare?: boolean
}

export function DraftEditor(props: DraftEditorProps) {
  const file = props.draft.files.find((f) => f.file === props.file) ?? props.draft.files[0]!
  const [doc, setDoc] = useState<LiveDoc | null>(null)
  const [openProblem, setOpenProblem] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    props.live.open(file.file).then(
      (opened) => !gone && setDoc(opened),
      (error: Error) => !gone && setOpenProblem(error.message),
    )
    return () => {
      gone = true
    }
  }, [props.live, file.file])
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('saved')
  const joined = useSyncExternalStore(
    (changed) => props.live.subscribe(changed),
    () => props.live.joined(),
  )
  useEffect(() => {
    if (!doc) {
      return
    }
    setLiveStatus(doc.status())
    return doc.subscribe(setLiveStatus)
  }, [doc])
  // Saving… only once something's been on its way a moment
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (liveStatus !== 'saving') {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), SAVING_AFTER_MS)
    return () => clearTimeout(timer)
  }, [liveStatus])
  const [markdownSide, setMarkdownSide] = useState(false)

  // the Markdown side's (and a long gap's) save, by block: the draft the page last agreed with
  const [base, setBase] = useState(props.draft)
  const baseNow = useRef(props.draft)
  const rebase = (draft: Draft) => {
    baseNow.current = draft
    setBase(draft)
  }
  const baseFile = base.files.find((f) => f.file === file.file) ?? file
  const [text, setText] = useState(file.content)
  const [status, setStatus] = useState<Status>('saved')
  const editor = useRef<MarkdownEditorHandle>(null)
  // the text as last saved or opened: past it, something's unsaved (the Markdown side)
  const agreed = useRef(file.content)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const latest = useRef({ text, base, props, markdownSide, doc })
  latest.current = { text, base, props, markdownSide, doc }

  // what the editor opens with: the draft as last agreed (the live document takes its place on the
  // rich side, and IDs come from the server, so it changes only on the Markdown side)
  const saved = useMemo(() => ({ source: baseFile.content, ids: baseFile.units.map((u) => u.id) }), [baseFile])
  // the comments the panel shows, marked: made again when the draft changes or the panel shows others,
  // so between reads they stay on their words as they're typed around
  const marksKey = JSON.stringify(props.marks ?? [])
  const shownKey = (props.view?.shown ?? []).map((c) => `${c.id}${c.resolved ? ' resolved' : ''}`).join('\n')
  const comments = useMemo(() => {
    const shown = new Map((props.view?.shown ?? []).map((c) => [c.id, c.resolved]))
    return (props.marks ?? []).flatMap((m) => (shown.has(m.id) ? [{ ...m, resolved: shown.get(m.id)! }] : []))
    // by what they say, not which arrays they came in, and again for each draft
  }, [marksKey, shownKey, props.draft])

  /** The page's blocks saved to the draft as changes, from `from`: the Markdown side's save, and a long gap's. */
  const saveBlocks = async (from: Idea, blocks: ReturnType<MarkdownEditorHandle['blocks']>): Promise<boolean> => {
    const handle = editor.current
    const made = draftChanges(from, { [file.file]: blocks }, handle?.movedWords() ?? [])
    if (!made.ok) {
      setStatus({ problem: made.message })
      return false
    }
    if (made.changes.length === 0) {
      return true
    }
    setStatus('saving')
    try {
      await api.changeDraft({ idea: latest.current.props.idea, changes: made.changes })
      return true
    } catch (error) {
      const problem =
        error instanceof ApiError ? (error.details as { problem?: string } | undefined)?.problem : undefined
      setStatus(problem ? { outdated: problem } : { problem: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /** The Markdown side's save of what's typed, once anything before it is done. */
  const save = async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inFlight.current) {
      await inFlight.current
    }
    const handle = editor.current
    if (!handle) {
      return true
    }
    const run = (async () => {
      const { text: sent, props: now } = latest.current
      if (same(sent, agreed.current)) {
        setStatus('saved')
        return true
      }
      if (!(await saveBlocks(ideaOf(baseNow.current), handle.blocks()))) {
        return false
      }
      agreed.current = sent
      // the draft as this save left it is the next one's base, if no one else changed the file meanwhile
      const fresh = await now.reread()
      const freshFile = fresh?.files.find((f) => f.file === file.file)
      if (fresh && freshFile && same(freshFile.content, sent)) {
        rebase(fresh)
      }
      setStatus('saved')
      return true
    })()
    inFlight.current = run
    try {
      return await run
    } finally {
      inFlight.current = null
    }
  }

  /** Everything typed stored: the Markdown side saved, or the live document's steps all confirmed. */
  const flush = async (): Promise<boolean> => {
    if (latest.current.markdownSide) {
      return save()
    }
    const live = latest.current.doc
    return live ? live.settle() : true
  }
  props.flush.current = flush

  // typed and not stored yet
  const unsaved = () => {
    if (latest.current.markdownSide) {
      return timer.current !== null || inFlight.current !== null || !same(latest.current.text, agreed.current)
    }
    const live = latest.current.doc
    return live !== null && (live.pending() > 0 || live.status() === 'gone')
  }
  const onUnsaved = props.onUnsaved
  useEffect(() => {
    onUnsaved?.(unsaved())
  }, [text, status, liveStatus, markdownSide, onUnsaved])

  // going elsewhere in the app waits for what's typed to be stored; one that fails asks first. Closing
  // the tab or reloading can't wait, so the browser asks
  useBlocker({
    shouldBlockFn: async () => {
      if (!unsaved()) {
        return false
      }
      if (await flush()) {
        return false
      }
      return !window.confirm('What you typed isn’t saved to the draft. Leave anyway?')
    },
    enableBeforeUnload: unsaved,
  })

  // on the Markdown side, the draft read again: after a save of ours, the new base; someone else's,
  // opened if nothing's unsaved (the rich side has their typing as it comes)
  useEffect(() => {
    if (!markdownSide) {
      return
    }
    const now = props.draft.files.find((f) => f.file === file.file)
    if (!now) {
      return
    }
    if (same(now.content, agreed.current) || latest.current.text === agreed.current) {
      if (!same(now.content, latest.current.text)) {
        setText(now.content)
        agreed.current = now.content
      }
      rebase(props.draft)
    }
  }, [props.draft, file.file, markdownSide])

  // away too long: the page saved by block onto the file as the server last confirmed it here (the
  // draft as last read can be older: typing confirmed since isn't in it, and would read as someone
  // else's), then opened again
  const recover = async (draft: Draft) => {
    const handle = editor.current
    const blocks = handle?.blocks()
    const confirmed = latest.current.doc?.confirmed()
    const text = confirmed ? handle?.fileOf(confirmed) : null
    if (!blocks || !text) {
      return
    }
    const ids = text.ids.filter((id) => id !== null)
    const from = ideaOf(draft)
    from.files = from.files.map((f) => (f.id === file.file ? { ...f, source: text.source, unitIds: ids } : f))
    from.nextId = Math.max(from.nextId, ...ids.map((id) => (Number(id.slice(1)) || 0) + 1))
    if (await saveBlocks(from, blocks)) {
      setStatus('saved')
      props.live.reopen(file.file)
    }
  }
  useEffect(() => {
    if (liveStatus === 'gone' && !markdownSide) {
      void recover(latest.current.props.draft)
    }
  }, [liveStatus])

  // nothing left unsaved when the page goes
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void save()
      }
    },
    // once, on leaving
    [],
  )

  /** Switching sides: to Markdown once what's typed is stored, as the draft now has it; back once it's saved. */
  const onSwitch = async (toMarkdown: boolean): Promise<boolean> => {
    if (!toMarkdown) {
      return save()
    }
    await doc?.settle()
    const fresh = await props.reread()
    const freshFile = fresh?.files.find((f) => f.file === file.file)
    if (fresh && freshFile) {
      setText(freshFile.content)
      agreed.current = freshFile.content
      rebase(fresh)
    }
    return true
  }

  const outdatedChoice = (problem: string) => (
    <span className="draft-editor-outdated" title={problem}>
      Someone changed this meanwhile
      <Button
        size="sm"
        variant="link"
        onClick={() => {
          // theirs: the draft as it now is
          setStatus('saved')
          if (latest.current.markdownSide) {
            const now = latest.current.props.draft
            const content = now.files.find((f) => f.file === file.file)?.content ?? ''
            agreed.current = content
            setText(content)
            rebase(now)
          } else {
            props.live.reopen(file.file)
          }
        }}
      >
        Use theirs
      </Button>
      <Button
        size="sm"
        variant="link"
        onClick={() => {
          // mine: counted from the draft as it now is, so it goes over theirs
          if (latest.current.markdownSide) {
            rebase(latest.current.props.draft)
            setTimeout(() => void save())
          } else {
            void props.reread().then((fresh) => fresh && recover(fresh))
          }
        }}
      >
        Keep mine
      </Button>
    </span>
  )

  const closed = liveStatus === 'closed' || openProblem !== null
  // this window isn't in the draft: it's full
  const full = !closed && !joined
  const statusText = closed
    ? 'You can no longer edit this idea'
    : full
      ? `The draft is full: ${props.live.limit()} people are editing it. You can read along, and type once someone leaves.`
      : typeof status === 'object'
        ? 'outdated' in status
          ? outdatedChoice(status.outdated)
          : `Not saved: ${status.problem}`
        : markdownSide
          ? status === 'saving'
            ? 'Saving…'
            : 'Saved'
          : liveStatus === 'offline'
            ? 'Offline. Your typing is kept here and will be sent when you are back.'
            : liveStatus === 'gone' || status === 'saving' || (liveStatus === 'saving' && slow)
              ? 'Saving…'
              : 'Saved'

  if (!doc) {
    return (
      <div className="draft-editor">
        {!props.bare && <div className="draft-editor-file">{props.lead ?? file.path}</div>}
        <p className="draft-editor-opening" role="status">
          {openProblem ? `This file can’t be edited: ${openProblem}` : 'Opening…'}
        </p>
      </div>
    )
  }

  return (
    <div
      className="draft-editor"
      onBlur={(event) => {
        // focus leaving the page (not into its own menus, drawn elsewhere, which keep it): the Markdown
        // side saves; the rich side has sent it already
        const to = event.relatedTarget as Element | null
        if (markdownSide && (!to || (!event.currentTarget.contains(to) && !to.closest('[data-editor-popup]')))) {
          void save()
        }
      }}
    >
      <MarkdownEditor
        ref={editor}
        flavor="page"
        label={file.path}
        value={text}
        saved={saved}
        live={doc}
        readOnly={closed || full}
        comments={comments}
        activeComment={props.view?.active ?? null}
        {...(props.view ? { onComment: props.view.onSelect } : {})}
        {...(props.bare ? {} : { lead: <div className="draft-editor-file">{props.lead ?? file.path}</div> })}
        status={statusText}
        onSwitch={onSwitch}
        onSide={setMarkdownSide}
        onChange={(next) => {
          setText(next)
          if (!latest.current.markdownSide) {
            // the rich side: the live document sends it
            return
          }
          setStatus((now) => (now === 'saved' ? 'saving' : now))
          if (timer.current) {
            clearTimeout(timer.current)
          }
          timer.current = setTimeout(() => void save(), PAUSE_MS)
        }}
      />
    </div>
  )
}

/** The draft as core works on it: its files, their blocks' IDs, and an ID past all of them for new ones. */
function ideaOf(draft: Draft): Idea {
  const ids = draft.files.flatMap((f) => [f.file, ...f.units.map((u) => u.id)])
  const highest = Math.max(0, ...ids.map((id) => Number(id.slice(1)) || 0))
  return {
    files: draft.files.map((f) => ({ id: f.file, path: f.path, source: f.content, unitIds: f.units.map((u) => u.id) })),
    nextId: highest + 1,
  }
}

/**
 * The same file, as far as the page is concerned: the editor writes a new last block without the
 * file's final newline, and the draft spaces blocks its own way, so blank lines don't count.
 */
function same(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  return norm(a) === norm(b)
}
