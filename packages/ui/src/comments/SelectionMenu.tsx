import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../controls/Button.tsx'
import { TextArea } from '../controls/TextArea.tsx'
import { selectionInSource, type TextSelection } from './selection.ts'
import './SelectionMenu.css'

export interface SelectionMenuProps {
  // the element the document is rendered in (a MarkdownView)
  documentRef: RefObject<HTMLElement | null>
  // the file's Markdown, so a suggested edit starts from the text as written
  source?: string
  // off on a version that isn't the latest, where nothing can be added
  enabled?: boolean
  // each action is offered only when the page handles it
  onComment?: (selection: TextSelection, body: string) => void
  onSuggest?: (selection: TextSelection, replacement: string, body: string) => void
  onSectionComment?: (section: NonNullable<TextSelection['section']>, body: string) => void
}

type Mode = 'menu' | 'comment' | 'suggest' | 'section'

interface Pending {
  selection: TextSelection
  range: Range
}

// Select text in the document, and a menu by it offers: comment on it,
// suggest an edit to it, or comment on the section it's in. Each opens a small
// form there. A selection made with the keyboard moves focus to the menu; Esc
// closes it.
export function SelectionMenu({
  documentRef,
  source,
  enabled = true,
  onComment,
  onSuggest,
  onSectionComment,
}: SelectionMenuProps) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [mode, setMode] = useState<Mode>('menu')
  const [body, setBody] = useState('')
  const [replacement, setReplacement] = useState('')
  const [, follow] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const fromKeyboard = useRef(false)
  // what's typed, read by the listeners without re-adding them
  const typed = useRef(false)
  typed.current = mode !== 'menu' && (body.trim() !== '' || (mode === 'suggest' && replacement !== ''))

  useEffect(() => {
    if (!enabled) {
      setPending(null)
      return
    }
    const check = (keyboard: boolean) => {
      const selection = window.getSelection()
      const root = documentRef.current
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !root) {
        return
      }
      const range = selection.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) {
        return
      }
      const found = selectionInSource(root, range)
      if (!found) {
        return
      }
      fromKeyboard.current = keyboard
      setPending({ selection: found, range: range.cloneRange() })
      setMode('menu')
      setBody('')
      setReplacement(source ? source.slice(found.start, found.end) : found.quote)
    }
    // once the pointer lets go, or a key that changes the selection is up
    const pointerUp = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        // let the browser finish the selection first
        window.setTimeout(() => check(false))
      }
    }
    const keyUp = (event: KeyboardEvent) => {
      if (event.shiftKey && !box.current?.contains(event.target as Node)) {
        check(true)
      }
    }
    // a click elsewhere closes it, unless something's been typed
    const pointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node) && !typed.current) {
        setPending(null)
      }
    }
    const moved = () => follow((n) => n + 1)
    document.addEventListener('pointerup', pointerUp)
    document.addEventListener('keyup', keyUp)
    document.addEventListener('pointerdown', pointerDown)
    window.addEventListener('scroll', moved, true)
    window.addEventListener('resize', moved)
    return () => {
      document.removeEventListener('pointerup', pointerUp)
      document.removeEventListener('keyup', keyUp)
      document.removeEventListener('pointerdown', pointerDown)
      window.removeEventListener('scroll', moved, true)
      window.removeEventListener('resize', moved)
    }
  }, [enabled, documentRef, source])

  useLayoutEffect(() => {
    if (pending && mode === 'menu' && fromKeyboard.current) {
      box.current?.querySelector('button')?.focus()
    }
  }, [pending, mode])

  if (!pending) {
    return null
  }
  const { selection } = pending
  const close = () => {
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }
  const original = source ? source.slice(selection.start, selection.end) : selection.quote
  // a suggestion must change something; a comment must say something
  const ready = mode === 'suggest' ? replacement !== original : body.trim() !== ''
  const submit = () => {
    if (!ready) {
      return
    }
    if (mode === 'comment') {
      onComment?.(selection, body.trim())
    } else if (mode === 'suggest') {
      onSuggest?.(selection, replacement, body.trim())
    } else if (mode === 'section' && selection.section) {
      onSectionComment?.(selection.section, body.trim())
    }
    close()
  }
  const rect = pending.range.getBoundingClientRect()
  const quote = selection.quote.length > 80 ? `${selection.quote.slice(0, 80)}…` : selection.quote

  return createPortal(
    <div
      ref={box}
      className={`selection-menu selection-menu-${mode}`}
      role={mode === 'menu' ? 'toolbar' : 'dialog'}
      aria-label={mode === 'menu' ? 'Selected text' : formTitle(mode)}
      style={{
        top: `calc(${rect.bottom}px + var(--space-2))`,
        left: `max(var(--space-3), min(${rect.left}px, calc(100vw - var(--selection-menu-width) - var(--space-3))))`,
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
    >
      {mode === 'menu' ? (
        <div className="selection-menu-actions">
          {onComment && (
            <Button size="sm" variant="ghost" onClick={() => setMode('comment')}>
              Comment
            </Button>
          )}
          {onSuggest && (
            <Button size="sm" variant="ghost" onClick={() => setMode('suggest')}>
              Suggest an edit
            </Button>
          )}
          {onSectionComment && selection.section && (
            <Button size="sm" variant="ghost" onClick={() => setMode('section')}>
              Comment on “{selection.section.title}”
            </Button>
          )}
        </div>
      ) : (
        <form
          className="selection-menu-form"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="selection-menu-context">
            {mode === 'section' ? <>Section · {selection.section?.title}</> : <q>{quote}</q>}
          </div>
          {mode === 'suggest' && (
            <TextArea
              className="selection-menu-replacement"
              value={replacement}
              onChange={setReplacement}
              onSubmit={submit}
              onCancel={close}
              rows={3}
              autoFocus
              aria-label="Replace it with"
            />
          )}
          <TextArea
            value={body}
            onChange={setBody}
            onSubmit={submit}
            onCancel={close}
            rows={mode === 'suggest' ? 2 : 3}
            autoFocus={mode !== 'suggest'}
            placeholder={mode === 'suggest' ? 'Why (optional)' : 'Add a comment'}
            aria-label={mode === 'suggest' ? 'Why' : 'Comment'}
          />
          <div className="selection-menu-buttons">
            <span className="selection-menu-hint">⌘↵ to send</span>
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!ready}>
              {mode === 'suggest' ? 'Suggest' : 'Comment'}
            </Button>
          </div>
        </form>
      )}
    </div>,
    document.body,
  )
}

function formTitle(mode: Mode): string {
  return mode === 'suggest' ? 'Suggest an edit' : mode === 'section' ? 'Comment on the section' : 'Comment'
}
