// A file of the idea's draft as one page in the editor (ui's MarkdownEditor, its page flavor): typed
// in place, blocks added and taken away by typing, and saved to the draft by itself, after a pause in
// typing, when focus leaves the page, before Commit, Preview or Close editor (flush), and before
// going anywhere else in the app, which waits for it. Closing the tab asks first if anything's unsaved.
//
// What's on screen is the truth while it's being typed in: each save is the difference between it
// and the draft as it last agreed with it (`base`), worked out by core's draftChanges from the blocks
// the editor knows by their draft IDs. Once saved, the draft as the server has it is the new base,
// and new blocks take the IDs it gave them.
//
// Someone else's changes reach the page when it has nothing unsaved: it opens the draft as it now is.
// With something unsaved, the next save is checked against what the blocks read when typing started:
// one they changed meanwhile is refused as outdated, and the person picks theirs or their own.
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@ideaf/api'
import { draftChanges, type Idea } from '@ideaf/core'
import { Button } from '@ideaf/ui'
import { MarkdownEditor, type MarkdownEditorHandle, type PageMark } from '@ideaf/ui/editor'
import { useBlocker } from '@tanstack/react-router'
import { api } from '../../../../../api.ts'
import type { Draft, EditingView } from './editing.tsx'
import './DraftEditor.css'

/** How long typing stops before what's typed is saved. */
const PAUSE_MS = 1000

type Status = 'saved' | 'saving' | { problem: string } | { outdated: string }

export interface DraftEditorProps {
  idea: string
  draft: Draft
  /** The file shown (its ID). */
  file: string
  /** The draft read again, once a save is in: as it now is. */
  reread: () => Promise<Draft | undefined>
  /** Set to a save of whatever's unsaved: the bar's Commit, Preview and Close editor wait for it. */
  flush: RefObject<(() => Promise<boolean>) | null>
  /** Whether something's typed and not saved yet, each time that changes. */
  onUnsaved?: (unsaved: boolean) => void
  /** The file's comments, where the draft has them. */
  marks?: PageMark[]
  /** Which of them the panel shows, the one that's active, and a mark clicked. */
  view?: EditingView
}

export function DraftEditor(props: DraftEditorProps) {
  const file = props.draft.files.find((f) => f.file === props.file) ?? props.draft.files[0]!
  // the draft the page last agreed with: what a save is the difference from
  const [base, setBase] = useState(props.draft)
  // the same, as soon as it changes: a save waiting on another counts from what that one left
  const baseNow = useRef(props.draft)
  const rebase = (draft: Draft) => {
    baseNow.current = draft
    setBase(draft)
  }
  const baseFile = base.files.find((f) => f.file === file.file) ?? file
  const [text, setText] = useState(file.content)
  const [status, setStatus] = useState<Status>('saved')
  const editor = useRef<MarkdownEditorHandle>(null)
  // the text as last saved or opened: past it, something's unsaved
  const agreed = useRef(file.content)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const latest = useRef({ text, base, props })
  latest.current = { text, base, props }

  // the editor's view of the draft as last agreed: a new object only when it's agreed again
  const saved = useMemo(() => ({ source: baseFile.content, ids: baseFile.units.map((u) => u.id) }), [baseFile])
  // the comments the panel shows, marked: made again when the draft changes (each save) or the panel
  // shows others, so between saves they stay on their words as they're typed around
  const marksKey = JSON.stringify(props.marks ?? [])
  const shownKey = (props.view?.shown ?? []).map((c) => `${c.id}${c.resolved ? ' resolved' : ''}`).join('\n')
  const comments = useMemo(() => {
    const shown = new Map((props.view?.shown ?? []).map((c) => [c.id, c.resolved]))
    return (props.marks ?? []).flatMap((m) => (shown.has(m.id) ? [{ ...m, resolved: shown.get(m.id)! }] : []))
    // by what they say, not which arrays they came in, and again for each draft
  }, [marksKey, shownKey, props.draft])
  const changed = useMemo(
    () => file.units.filter((u) => u.origin.kind === 'new' || u.origin.changed).map((u) => u.id),
    [file],
  )

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
      // nothing since the last save: a save that waited on it (leaving as focus left) has none to send
      if (same(sent, agreed.current)) {
        setStatus('saved')
        return true
      }
      let from = baseNow.current
      const blocks = handle.blocks()
      // a cut saved as deletions, then pasted: until it's pasted a cut is a deletion, and pasted, it's
      // a move. Its blocks are back on the page with their IDs, so their deletions come out of the
      // draft first, and the draft it's counted from has them again
      const known = new Set(from.files.flatMap((f) => f.units.map((u) => u.id)))
      const back = from.changes.filter(({ change }) => {
        if (change.kind !== 'delete') {
          return false
        }
        return !known.has(change.id) && blocks.some((b) => b.id === change.id)
      })
      if (back.length > 0) {
        setStatus('saving')
        try {
          for (const c of back) {
            await api.undoDraftChange({ idea: now.idea, key: c.key })
          }
          from = await api.getDraft({ idea: now.idea })
          rebase(from)
        } catch (error) {
          setStatus({ problem: error instanceof Error ? error.message : String(error) })
          return false
        }
      }
      const made = draftChanges(ideaOf(from), { [file.file]: blocks }, handle.movedWords())
      if (!made.ok) {
        setStatus({ problem: made.message })
        return false
      }
      if (made.changes.length === 0) {
        agreed.current = sent
        setStatus('saved')
        return true
      }
      setStatus('saving')
      try {
        await api.changeDraft({ idea: now.idea, changes: made.changes })
        agreed.current = sent
        // the draft as this save left it is the next one's base, if no one else changed the file meanwhile
        const fresh = await now.reread()
        const freshFile = fresh?.files.find((f) => f.file === file.file)
        if (fresh && freshFile && same(freshFile.content, sent)) {
          rebase(fresh)
        }
        setStatus('saved')
        return true
      } catch (error) {
        const problem =
          error instanceof ApiError ? (error.details as { problem?: string } | undefined)?.problem : undefined
        setStatus(problem ? { outdated: problem } : { problem: error instanceof Error ? error.message : String(error) })
        return false
      }
    })()
    inFlight.current = run
    try {
      return await run
    } finally {
      inFlight.current = null
    }
  }
  props.flush.current = save

  // typed and not in the draft yet: waiting to be sent, on its way, or refused
  const unsaved = () =>
    timer.current !== null || inFlight.current !== null || !same(latest.current.text, agreed.current)
  const onUnsaved = props.onUnsaved
  useEffect(() => {
    onUnsaved?.(!same(text, agreed.current))
  }, [text, status, onUnsaved])

  // going elsewhere in the app waits for the save; one that fails asks first. Closing the tab or
  // reloading can't wait, so the browser asks
  useBlocker({
    shouldBlockFn: async () => {
      if (!unsaved()) {
        return false
      }
      if (await save()) {
        return false
      }
      return !window.confirm('What you typed isn’t saved to the draft. Leave anyway?')
    },
    enableBeforeUnload: unsaved,
  })

  // the draft read again: after a save of ours, the new base; someone else's, opened if nothing's unsaved
  useEffect(() => {
    const now = props.draft.files.find((f) => f.file === file.file)
    if (!now) {
      return
    }
    if (same(now.content, agreed.current) || latest.current.text === agreed.current) {
      if (!same(now.content, latest.current.text)) {
        // theirs, and nothing of ours unsaved: open the draft as it now is
        setText(now.content)
        agreed.current = now.content
      }
      rebase(props.draft)
    }
    // otherwise something of ours is unsaved: the next save is checked against the base it was typed on
  }, [props.draft, file.file])

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

  const statusText =
    status === 'saved' ? (
      'Saved to the draft'
    ) : status === 'saving' ? (
      'Saving…'
    ) : 'outdated' in status ? (
      <span className="draft-editor-outdated">
        Someone changed this meanwhile
        <Button
          size="sm"
          variant="link"
          onClick={() => {
            // theirs: the draft as it now is
            const now = latest.current.props.draft
            const content = now.files.find((f) => f.file === file.file)?.content ?? ''
            agreed.current = content
            setText(content)
            rebase(now)
            setStatus('saved')
          }}
        >
          Use theirs
        </Button>
        <Button
          size="sm"
          variant="link"
          onClick={() => {
            // mine: counted from the draft as it now is, so it goes over theirs
            rebase(latest.current.props.draft)
            setTimeout(() => void save())
          }}
        >
          Keep mine
        </Button>
      </span>
    ) : (
      `Not saved: ${status.problem}`
    )

  return (
    <div
      className="draft-editor"
      onBlur={(event) => {
        // focus leaving the page (not into its own menus, drawn elsewhere, which keep it)
        const to = event.relatedTarget as Element | null
        if (!to || (!event.currentTarget.contains(to) && !to.closest('[data-editor-popup]'))) {
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
        changed={changed}
        comments={comments}
        activeComment={props.view?.active ?? null}
        {...(props.view ? { onComment: props.view.onSelect } : {})}
        lead={<p className="draft-editor-file">{file.path}</p>}
        status={statusText}
        onChange={(next) => {
          setText(next)
          // something unsaved: it's on its way
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
