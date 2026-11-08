import { Popover } from '@base-ui/react/popover'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../controls/Button.tsx'
import { TextArea } from '../controls/TextArea.tsx'
import { selectionInSource, type TextSelection } from './selection.ts'
import './SelectionMenu.css'

export interface SelectionMenuProps {
  // the element the document is rendered in (a MarkdownView)
  documentRef: RefObject<HTMLElement | null>
  // the file's Markdown, so a suggested edit starts from the text as written
  source?: string
  // what a suggestion on a selection replaces, when that's wider than the selection (whole formatting),
  // or null when there can't be one there; by default, the selection's source
  suggestionOf?: (selection: TextSelection) => string | null
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
  // each selection opens the menu afresh
  id: number
}

// Select text in the document, and a menu by it offers: comment on it,
// suggest an edit to it, or comment on the section it's in. Each opens a small
// form there. A selection made with the keyboard moves focus to the menu; Esc
// closes it, and so does a click elsewhere until something's been typed.
//
// Base UI's popover places it, against the selected text: below it, or above
// when there's no room, and following it as the document scrolls.
export function SelectionMenu({
  documentRef,
  source,
  suggestionOf,
  enabled = true,
  onComment,
  onSuggest,
  onSectionComment,
}: SelectionMenuProps) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [mode, setMode] = useState<Mode>('menu')
  const [body, setBody] = useState('')
  const [replacement, setReplacement] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const fromKeyboard = useRef(false)
  const selections = useRef(0)
  // what's typed, read by the listeners without re-adding them
  const typed = useRef(false)
  typed.current = mode !== 'menu' && (body.trim() !== '' || (mode === 'suggest' && replacement !== ''))
  // what a suggestion on a selection replaces
  const original = (selection: TextSelection): string | null =>
    suggestionOf ? suggestionOf(selection) : source ? source.slice(selection.start, selection.end) : selection.quote

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
      setPending({ selection: found, range: range.cloneRange(), id: ++selections.current })
      setMode('menu')
      setBody('')
      setReplacement(original(found) ?? '')
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
    document.addEventListener('pointerup', pointerUp)
    document.addEventListener('keyup', keyUp)
    return () => {
      document.removeEventListener('pointerup', pointerUp)
      document.removeEventListener('keyup', keyUp)
    }
  }, [enabled, documentRef, source, suggestionOf])

  // the selected text, for the popover to be placed against; the document is
  // where it looks for what scrolls
  const anchor = useMemo(
    () =>
      pending && {
        getBoundingClientRect: () => pending.range.getBoundingClientRect(),
        contextElement: documentRef.current ?? undefined,
      },
    [pending, documentRef],
  )

  if (!pending || !anchor) {
    return null
  }
  const { selection } = pending
  const close = () => {
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }
  const replaced = original(selection)
  // a suggestion must change something; a comment must say something
  const ready = mode === 'suggest' ? replaced !== null && replacement !== replaced : body.trim() !== ''
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
  const quote = selection.quote.length > 80 ? `${selection.quote.slice(0, 80)}…` : selection.quote

  return (
    <Popover.Root
      key={pending.id}
      open
      onOpenChange={(open, details) => {
        // Esc always closes it; anything else (a click elsewhere, focus
        // moving away) only until something's been typed
        if (!open && (details.reason === 'escape-key' || !typed.current)) {
          close()
        }
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          className="selection-menu-positioner"
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={remToPx(0.5)}
          collisionPadding={remToPx(0.75)}
        >
          <Popover.Popup
            ref={box}
            className={`selection-menu selection-menu-${mode}`}
            role={mode === 'menu' ? 'toolbar' : 'dialog'}
            aria-label={mode === 'menu' ? 'Selected text' : formTitle(mode)}
            // focus stays in the document after a selection with the
            // pointer; one made with the keyboard moves to the menu
            initialFocus={() => fromKeyboard.current && (box.current?.querySelector('button') ?? true)}
            finalFocus={false}
          >
            {mode === 'menu' ? (
              <div className="selection-menu-actions">
                {onComment && (
                  <Button size="sm" variant="ghost" onClick={() => setMode('comment')}>
                    Comment
                  </Button>
                )}
                {onSuggest && replaced !== null && (
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
                  {mode === 'section' ? (
                    <>Section · {selection.section?.title}</>
                  ) : mode === 'suggest' &&
                    replaced !== null &&
                    replaced !== source?.slice(selection.start, selection.end) ? (
                    <>
                      Replacing <code>{replaced}</code>
                    </>
                  ) : (
                    <q>{quote}</q>
                  )}
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
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function remToPx(rem: number): number {
  return rem * parseFloat(getComputedStyle(document.documentElement).fontSize || '16')
}

function formTitle(mode: Mode): string {
  return mode === 'suggest' ? 'Suggest an edit' : mode === 'section' ? 'Comment on the section' : 'Comment'
}
