import { Popover } from '@base-ui/react/popover'
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../controls/Button.tsx'
import { inlineMarkdown } from '../document/MarkdownView.tsx'
import { MarkdownEditor } from '../editor/MarkdownEditor.tsx'
import { COMMENT_LIMIT } from './limit.ts'
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
  // offer "Add to your review" too: kept pending, for only you to see until you submit your review
  addToReview?: boolean
  // each action is offered only when the page handles it; `pending`: added to your review
  onComment?: (selection: TextSelection, body: string, pending: boolean) => void
  onSuggest?: (selection: TextSelection, replacement: string, body: string, pending: boolean) => void
  onSectionComment?: (section: NonNullable<TextSelection['section']>, body: string, pending: boolean) => void
  // a comment on a whole block, from the button beside it: where it starts and ends in the source, and
  // what kind it is (a heading's button comments on its section)
  onBlockComment?: (block: BlockTarget, body: string, pending: boolean) => void
}

/** A block a comment can be on, from the button beside it. */
export interface BlockTarget {
  start: number
  end: number
  // what kind of block, as the form names it: "table", "list item"
  label: string
}

type Mode = 'menu' | 'comment' | 'suggest' | 'section' | 'block'

interface Pending {
  selection: TextSelection
  // a whole block, from the button beside it
  block?: BlockTarget
  range: Range
  // each selection opens the menu afresh
  id: number
}

// Select text in the document, and a menu by it offers: comment on it,
// suggest an edit to it, or comment on the section it's in. Each opens a small
// form there. A selection made with the keyboard moves focus to the menu; Esc
// closes it, and so does a click elsewhere until something's been typed.
//
// Base UI's popover places it, following the document as it scrolls: the menu
// centred above the selected text (below when there's no room), where it
// doesn't cover the next line or the start of the one before; a form beside the document, level with the text, in the
// comments column where the finished comment will be (wherever there's room on
// a narrow screen).
export function SelectionMenu({
  documentRef,
  source,
  suggestionOf,
  enabled = true,
  addToReview = false,
  onComment,
  onSuggest,
  onSectionComment,
  onBlockComment,
}: SelectionMenuProps) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [mode, setMode] = useState<Mode>('menu')
  const [body, setBody] = useState('')
  const [replacement, setReplacement] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const fromKeyboard = useRef(false)
  // the block a form was opened on with the keyboard (C), where its start is: focus goes back to it
  // once the form is sent or put away with Escape
  const returnTo = useRef<number | null>(null)
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

  // while a form is open, the text it's on stays marked: the browser's own
  // selection goes as soon as the form takes focus (a highlight, not a change
  // to the document, so nothing else is disturbed)
  useEffect(() => {
    if (!pending || mode === 'menu' || typeof CSS === 'undefined' || !('highlights' in CSS)) {
      return
    }
    CSS.highlights.set(HIGHLIGHT, new Highlight(pending.range))
    return () => {
      CSS.highlights.delete(HIGHLIGHT)
    }
  }, [pending, mode])

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
  // a form's place: the document's right edge, level with the selected text
  const beside = useMemo(
    () =>
      pending && {
        getBoundingClientRect: () => {
          const text = pending.range.getBoundingClientRect()
          const root = documentRef.current
          const pane = root?.closest('.idea-page-document') ?? root
          const right = pane?.getBoundingClientRect().right ?? text.right
          return DOMRect.fromRect({ x: right, y: text.top, width: 0, height: text.height })
        },
        contextElement: documentRef.current ?? undefined,
      },
    [pending, documentRef],
  )

  // the button beside the block pointed at: a comment on the block, or a heading's section
  const blockButton =
    enabled && (onBlockComment || onSectionComment) && !pending ? (
      <BlockButton
        documentRef={documentRef}
        sections={onSectionComment !== undefined}
        blocks={onBlockComment !== undefined}
        onOpen={(element, keyboard) => {
          const opened = blockSelection(element)
          if (!opened) {
            return
          }
          returnTo.current = keyboard ? Number(element.dataset['start']) : null
          const range = document.createRange()
          range.selectNodeContents(element)
          fromKeyboard.current = true
          setPending({ ...opened, range, id: ++selections.current })
          setMode(opened.block ? 'block' : 'section')
          setBody('')
        }}
      />
    ) : null

  if (!pending || !anchor) {
    return blockButton
  }
  const { selection } = pending
  const close = (restore = false) => {
    setPending(null)
    window.getSelection()?.removeAllRanges()
    const start = returnTo.current
    returnTo.current = null
    const root = documentRef.current
    if (restore && start !== null && root) {
      // once the page has drawn the comment (its block may be drawn again, with its mark)
      requestAnimationFrame(() => {
        const block = blocksIn(root).find((b) => Number(b.dataset['start']) === start)
        if (block) {
          focusBlock(block)
        }
      })
    }
  }
  const replaced = original(selection)
  const pendingBlock = pending.block
  // a suggestion must change something; a comment must say something
  const ready =
    body.length <= COMMENT_LIMIT &&
    (mode === 'suggest' ? replaced !== null && replacement !== replaced : body.trim() !== '')
  const submit = (pending = false) => {
    if (!ready) {
      return
    }
    if (mode === 'comment') {
      onComment?.(selection, body.trim(), pending)
    } else if (mode === 'suggest') {
      onSuggest?.(selection, replacement, body.trim(), pending)
    } else if (mode === 'section' && selection.section) {
      onSectionComment?.(selection.section, body.trim(), pending)
    } else if (mode === 'block' && pendingBlock) {
      onBlockComment?.(pendingBlock, body.trim(), pending)
    }
    close(true)
  }
  // the button pressed goes as the form takes the menu's place: focus moves to the popup first, so
  // the popup doesn't take it back from the box once the box has it (the box takes it when it's ready)
  const openForm = (form: Exclude<Mode, 'menu'>) => {
    box.current?.focus()
    setMode(form)
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
          close(details.reason === 'escape-key')
        }
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          className="selection-menu-positioner"
          anchor={mode === 'menu' ? anchor : (beside ?? anchor)}
          side={mode === 'menu' ? 'top' : 'right'}
          align={mode === 'menu' ? 'center' : 'start'}
          sideOffset={remToPx(mode === 'menu' ? 0.5 : 1)}
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
                  <Button size="sm" variant="ghost" onClick={() => openForm('comment')}>
                    Comment
                  </Button>
                )}
                {onSuggest && replaced !== null && (
                  <Button size="sm" variant="ghost" onClick={() => openForm('suggest')}>
                    Suggest an edit
                  </Button>
                )}
                {onSectionComment && selection.section && (
                  <>
                    {/* the section, not the selection: set apart */}
                    <span className="selection-menu-divider" aria-hidden />
                    <Button size="sm" variant="ghost" onClick={() => openForm('section')}>
                      Comment on “{selection.section.title}”
                    </Button>
                  </>
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
                  ) : mode === 'block' && pendingBlock ? (
                    <>
                      {capitalized(pendingBlock.label)} · <q>{quote}</q>
                    </>
                  ) : mode === 'suggest' &&
                    replaced !== null &&
                    replaced !== source?.slice(selection.start, selection.end) ? (
                    <>
                      Replacing <q>{inlineMarkdown(replaced) ?? replaced}</q>
                    </>
                  ) : (
                    <q>{quote}</q>
                  )}
                </div>
                {mode === 'suggest' && (
                  <MarkdownEditor
                    className="selection-menu-replacement"
                    flavor="inline"
                    toolbar="focus"
                    value={replacement}
                    onChange={setReplacement}
                    onSubmit={() => submit()}
                    onCancel={() => close(true)}
                    rows={1}
                    autoFocus
                    label="Replace it with"
                  />
                )}
                <MarkdownEditor
                  value={body}
                  onChange={setBody}
                  onSubmit={() => submit()}
                  onCancel={() => close(true)}
                  rows={mode === 'suggest' ? 2 : 3}
                  autoFocus={mode !== 'suggest'}
                  // beside the replacement, only the box in use shows its toolbar
                  toolbar={mode === 'suggest' ? 'focus' : 'always'}
                  placeholder={mode === 'suggest' ? 'Why (optional)' : 'Add a comment'}
                  label={mode === 'suggest' ? 'Why' : 'Comment'}
                  limit={COMMENT_LIMIT}
                  footer={
                    <>
                      {mode === 'suggest' && replacement === replaced && (
                        <span className="selection-menu-hint">Change the text to suggest an edit</span>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => close(true)}>
                        Cancel
                      </Button>
                      {addToReview && (
                        <Button size="sm" disabled={!ready} onClick={() => submit(true)}>
                          Add to your review
                        </Button>
                      )}
                      <Button size="sm" variant="primary" type="submit" disabled={!ready}>
                        {mode === 'suggest' ? 'Suggest' : 'Comment'}
                      </Button>
                    </>
                  }
                />
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

/** The name of the highlight that marks the text a form is on (SelectionMenu.css). */
const HIGHLIGHT = 'selection-pending'

function formTitle(mode: Mode): string {
  return mode === 'suggest'
    ? 'Suggest an edit'
    : mode === 'section'
      ? 'Comment on the section'
      : mode === 'block'
        ? 'Comment on the block'
        : 'Comment'
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The block of the document an element is in, that a comment can be on: a top-level block, or a list item. */
function blockOf(root: HTMLElement, element: Element | null): HTMLElement | null {
  const prose = root.querySelector('.prose')
  for (let at = element; at && at !== root; at = at.parentElement) {
    if (
      at instanceof HTMLElement &&
      at.dataset['start'] !== undefined &&
      (at.parentElement === prose || at.tagName === 'LI')
    ) {
      return at
    }
  }
  return null
}

/**
 * The blocks of the document in order, as the arrow keys move through them: the top-level blocks and
 * list items, not a list itself (its items are).
 */
function blocksIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-start]')].filter(
    (element) =>
      blockOf(root, element) === element &&
      !((element.tagName === 'UL' || element.tagName === 'OL') && element.querySelector('li[data-start]')),
  )
}

/**
 * Focuses a block for the keys: focusable only while it has focus (a code block or a table that
 * scrolls and stayed focusable only by script would be one the keyboard can't reach).
 */
function focusBlock(block: HTMLElement) {
  if (!block.hasAttribute('tabindex')) {
    block.tabIndex = -1
    block.dataset['keyFocus'] = ''
  }
  block.focus({ preventScroll: true })
}

/** What kind of block an element is, as the form names it. */
function labelOf(element: HTMLElement): string {
  if (element.tagName === 'LI') {
    return 'list item'
  }
  if (element.tagName === 'BLOCKQUOTE') {
    return 'quote'
  }
  if (element.matches('.md-table') || element.querySelector(':scope > .md-table')) {
    return 'table'
  }
  if (element.querySelector('svg')) {
    return 'diagram'
  }
  if (element.tagName === 'PRE' || element.querySelector(':scope > pre')) {
    return 'code'
  }
  if (element.querySelector('img') && element.textContent?.trim() === '') {
    return 'image'
  }
  return 'paragraph'
}

/** A block, as a form opens on it: its words, where it is, and the section a heading starts. */
function blockSelection(element: HTMLElement): Pick<Pending, 'selection' | 'block'> | null {
  const start = Number(element.dataset['start'])
  const end = Number(element.dataset['end'])
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null
  }
  const quote = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (/^H[1-6]$/.test(element.tagName)) {
    return { selection: { quote, start, end, section: { title: quote, heading: start } } }
  }
  return { selection: { quote, start, end, section: null }, block: { start, end, label: labelOf(element) } }
}

/**
 * The button beside the block pointed at, in the margin to its right, level with its first line: a
 * comment on the block, or on a heading's section. It stays while the pointer goes over to it.
 *
 * With the document focused, the arrow keys move a block at a time (from the one clicked in, or the
 * first in view), the button beside the block in focus, and C comments on it.
 */
function BlockButton({
  documentRef,
  sections,
  blocks,
  onOpen,
}: {
  documentRef: RefObject<HTMLElement | null>
  sections: boolean
  blocks: boolean
  onOpen: (element: HTMLElement, keyboard: boolean) => void
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const hide = useRef<number | undefined>(undefined)
  useEffect(() => {
    const root = documentRef.current
    if (!root) {
      return
    }
    const move = (event: PointerEvent) => {
      const block = blockOf(root, event.target as Element)
      const heading = block !== null && /^H[1-6]$/.test(block.tagName)
      if (block && (heading ? sections : blocks)) {
        window.clearTimeout(hide.current)
        setTarget(block)
      }
    }
    const leave = () => {
      hide.current = window.setTimeout(() => setTarget(null), 400)
    }
    root.addEventListener('pointermove', move)
    root.addEventListener('pointerleave', leave)
    return () => {
      window.clearTimeout(hide.current)
      root.removeEventListener('pointermove', move)
      root.removeEventListener('pointerleave', leave)
    }
  }, [documentRef, sections, blocks])
  // the keys, read by the listeners without adding them again
  const opens = useRef(onOpen)
  opens.current = onOpen
  useEffect(() => {
    const root = documentRef.current
    if (!root) {
      return
    }
    const usable = (block: HTMLElement) => (/^H[1-6]$/.test(block.tagName) ? sections : blocks)
    // the block last clicked in: the arrow keys start from it
    let clicked: HTMLElement | null = null
    const focusedBlock = () => {
      const at = document.activeElement
      return at instanceof HTMLElement && at !== root && blockOf(root, at) === at ? at : null
    }
    const pointerDown = (event: PointerEvent) => {
      clicked = blockOf(root, event.target as Element)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }
      const focused = focusedBlock()
      // the document or a block in it, not a link or a button in a block
      if (event.target !== root && event.target !== focused) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const list = blocksIn(root).filter(usable)
        const down = event.key === 'ArrowDown'
        const here = focused ?? (clicked?.isConnected ? clicked : null)
        const i = here ? list.indexOf(here) : -1
        let next: HTMLElement | undefined
        if (i >= 0) {
          // from the block in focus, the next one; from the one clicked in, that one
          next = here === focused ? list[Math.min(Math.max(i + (down ? 1 : -1), 0), list.length - 1)] : here!
        } else {
          // the first block in view, going down; the last, going up
          const pane = (root.closest('.idea-page-document') as HTMLElement | null)?.getBoundingClientRect()
          const top = Math.max(pane?.top ?? 0, 0)
          const bottom = Math.min(pane?.bottom ?? window.innerHeight, window.innerHeight)
          const inView = list.filter((b) => {
            const box = b.getBoundingClientRect()
            return box.bottom > top && box.top < bottom
          })
          next = down ? (inView[0] ?? list[0]) : (inView.at(-1) ?? list.at(-1))
        }
        if (!next) {
          return
        }
        event.preventDefault()
        focusBlock(next)
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        next.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
      } else if (event.key.toLowerCase() === 'c' && focused && usable(focused)) {
        event.preventDefault()
        opens.current(focused, true)
      }
    }
    // the button follows the block in focus, and goes once focus leaves the document
    const focusIn = (event: FocusEvent) => {
      const block = event.target instanceof HTMLElement && event.target === focusedBlock() ? event.target : null
      if (block && usable(block)) {
        window.clearTimeout(hide.current)
        setTarget(block)
      }
    }
    const focusOut = (event: FocusEvent) => {
      const left = event.target
      if (left instanceof HTMLElement && left.dataset['keyFocus'] !== undefined) {
        left.removeAttribute('tabindex')
        delete left.dataset['keyFocus']
      }
      if (!root.contains(event.relatedTarget as Node | null) && focusedBlock() === null) {
        hide.current = window.setTimeout(() => setTarget(null), 400)
      }
    }
    root.addEventListener('pointerdown', pointerDown)
    root.addEventListener('keydown', keyDown)
    root.addEventListener('focusin', focusIn)
    root.addEventListener('focusout', focusOut)
    return () => {
      root.removeEventListener('pointerdown', pointerDown)
      root.removeEventListener('keydown', keyDown)
      root.removeEventListener('focusin', focusIn)
      root.removeEventListener('focusout', focusOut)
    }
  }, [documentRef, sections, blocks])
  useLayoutEffect(() => {
    if (!target) {
      setAt(null)
      return
    }
    const place = () => {
      const box = target.getBoundingClientRect()
      setAt({ top: box.top, left: box.right + remToPx(0.75) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [target])
  if (!target || !at) {
    return null
  }
  const heading = /^H[1-6]$/.test(target.tagName)
  const label = heading ? 'Comment on this section' : `Comment on this ${labelOf(target)}`
  return createPortal(
    <button
      type="button"
      className="block-comment-button"
      style={{ top: at.top, left: at.left }}
      aria-label={label}
      title={label}
      onPointerEnter={() => window.clearTimeout(hide.current)}
      onPointerLeave={() => {
        hide.current = window.setTimeout(() => setTarget(null), 400)
      }}
      onClick={() => onOpen(target, false)}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <path
          d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </button>,
    document.body,
  )
}
