// A box for writing Markdown that reads as it will look: bold is bold, a list is a list. GitHub's box
// around it (a toolbar on top, the text, the buttons at the foot), its shortcuts, and Markdown typed by
// hand still works. View Markdown source, at the end of the toolbar, shows the source in the plain box, and
// that choice is remembered in this browser.
//
// It takes Markdown and gives Markdown, as TextArea does, so it goes where a TextArea went. The rich
// side loads as a chunk of its own. Until it's loaded and drawn, the text stands in as a comment shows
// it (MarkdownView, the same styles), so nothing moves when the editor takes its place.
//
// Flavors: full (comments, replies, summaries), and inline for a suggested edit's replacement (marks
// and links, no blocks).
import { markdownTree } from '@ideaf/core'
import {
  type CSSProperties,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { TextArea } from '../controls/TextArea.tsx'
import { MarkdownView } from '../document/MarkdownView.tsx'
import type { Action, Flavor, RichEditor, Selection, TableOp } from './milkdown.ts'
import { type PlainEdit, plainEdit, plainHeading, plainLink, plainShortcut, plainTable } from './plain.ts'
import { ContextMenu, type ContextMenuAt } from './ContextMenu.tsx'
import { EditorOwner } from './owner.ts'
import { Toolbar } from './Toolbar.tsx'
// the text is drawn as a comment is: the same prose styles
import '../document/MarkdownView.css'
import './MarkdownEditor.css'

const RichSurface = lazy(() => import('./RichSurface.tsx'))

/** Fetches the rich side ahead of need (when a page is idle), so a box opens rich. */
export function preloadMarkdownEditor(): void {
  void import('./RichSurface.tsx')
}

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  /** For screen readers: what the box is ("Reply"). */
  label: string
  placeholder?: string
  flavor?: Flavor
  /** ⌘↵ (Ctrl+↵): send it. */
  onSubmit?: () => void
  /** Esc: give up. */
  onCancel?: () => void
  autoFocus?: boolean
  /** Its height at rest, in lines; it grows as it fills. */
  rows?: number
  /** Inside the box, under the text: its buttons. */
  footer?: ReactNode
  className?: string
}

const STORED = 'ideaf:editor:markdown'
const NOWHERE: Selection = {
  active: new Set(),
  inTable: false,
  link: null,
  text: '',
  heading: 0,
  tableOff: new Set(),
  range: false,
  disabled: new Set(),
  why: {},
}

/** The switch to the source view, remembered in this browser (not the account). */
function useMarkdownSwitch(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(STORED) === '1'
    } catch {
      return false
    }
  })
  const set = useCallback((next: boolean) => {
    setOn(next)
    try {
      if (next) {
        localStorage.setItem(STORED, '1')
      } else {
        localStorage.removeItem(STORED)
      }
    } catch {
      // not kept: it's still switched for now
    }
  }, [])
  return [on, set]
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const flavor = props.flavor ?? 'full'
  const [markdown, setMarkdown] = useMarkdownSwitch()
  const [rich, setRich] = useState<RichEditor | null>(null)
  const [selection, setSelection] = useState<Selection>(NOWHERE)
  // the link box: open, and what its fields start as (the selected text, and the link it's in)
  // where it opens: under the selected text on the rich side, under the Link button on the Markdown side
  const [linking, setLinking] = useState<{ text: string; href: string | null; at: DOMRect | null } | null>(null)
  // the editor's right-click menu: where, and what it's on
  const [context, setContext] = useState<ContextMenuAt | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLDivElement>(null)
  // this editor's popups are tagged with it (owner.ts)
  const owner = useId()
  const linkingNow = useRef(false)
  linkingNow.current = linking !== null
  // focus in this editor's toolbar or one of its popups: the caret stays marked; back in the text, or
  // away from the editor, it's the browser's own again
  useEffect(() => {
    if (!rich) {
      return
    }
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Element | null
      // back in the text: the mark hides itself (an update now would undo the press placing the caret)
      if (!target || linkingNow.current || rich.dom().contains(target)) {
        return
      }
      const bar = root.current?.querySelector('.md-editor-bar')
      const ours = Boolean(bar?.contains(target) || target.closest(`[data-editor-popup="${CSS.escape(owner)}"]`))
      rich.hold(ours ? 'selection' : false)
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [rich, owner])
  // focus follows the switch to the other side
  const moved = useRef(false)
  // the plain box is what's typed in on the Markdown side, and while the rich side loads
  const plain = markdown || !rich

  const editPlain = (action: Action | ((value: string, start: number, end: number) => PlainEdit)) => {
    const box = textarea.current
    if (!box) {
      return
    }
    const edit =
      typeof action === 'function'
        ? action(box.value, box.selectionStart, box.selectionEnd)
        : plainEdit(action, box.value, box.selectionStart, box.selectionEnd)
    box.focus()
    box.setSelectionRange(edit.start, edit.end)
    // typed in, so the box's own undo takes it back; setRangeText where that isn't supported
    if (!document.execCommand('insertText', false, edit.text)) {
      box.setRangeText(edit.text, edit.start, edit.end)
      props.onChange(box.value)
    }
    box.setSelectionRange(...edit.select)
  }

  // focus back to the text once a popup closes. When focus went away by itself (a press in the text or
  // on a button, Tab), it's left where it went: pulling it back to the text would put the old caret
  // back under a press. Only when it went nowhere (Tab past the box's last button) does it come back.
  const refocus = (away = false) => {
    const back = () => (plain ? textarea.current?.focus() : rich?.focus())
    if (!away) {
      back()
      return
    }
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        back()
      }
    })
  }

  const openLink = () => {
    if (plain) {
      const box = textarea.current
      setLinking({ text: box ? box.value.slice(box.selectionStart, box.selectionEnd) : '', href: null, at: null })
    } else if (!selection.disabled.has('link')) {
      setLinking({ text: selection.text, href: selection.link, at: rich?.selectionRect() ?? null })
      // the text the link goes on stays marked while focus is in the box
      rich?.hold('link')
    }
  }

  const act = (action: Action) => {
    if (!plain && selection.disabled.has(action)) {
      return
    }
    if (action === 'link') {
      openLink()
    } else if (plain) {
      editPlain(action)
    } else if (action !== 'table' && action !== 'heading') {
      rich?.run(action)
    }
  }

  const switchTo = (on: boolean) => {
    moved.current = true
    setMarkdown(on)
    setSelection(NOWHERE)
  }
  useEffect(() => {
    if (moved.current && markdown) {
      moved.current = false
      textarea.current?.focus()
    }
  }, [markdown])
  // the rich side takes focus once it's drawn (not before: it's hidden until then)
  const focusWhenReady = useRef(Boolean(props.autoFocus))
  useEffect(() => {
    if ((moved.current || focusWhenReady.current) && rich && !markdown) {
      moved.current = false
      focusWhenReady.current = false
      rich.focus()
    }
  }, [rich, markdown])

  // the source box is as tall as its text, as the rich side is (its rows are the least it shows)
  useLayoutEffect(() => {
    const box = textarea.current
    if (!box) {
      return
    }
    const fit = () => {
      box.style.height = 'auto'
      box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`
    }
    fit()
    // and again when it's narrower or wider, and the text wraps anew
    let width = box.clientWidth
    const resized = new ResizeObserver(() => {
      if (box.clientWidth !== width) {
        width = box.clientWidth
        fit()
      }
    })
    resized.observe(box)
    return () => resized.disconnect()
  }, [props.value, plain])

  const box = (
    <TextArea
      ref={textarea}
      className="md-editor-source"
      value={props.value}
      onChange={props.onChange}
      rows={props.rows ?? 3}
      aria-label={props.label}
      {...(props.placeholder ? { placeholder: props.placeholder } : {})}
      {...(props.autoFocus ? { autoFocus: true } : {})}
      {...(props.onSubmit ? { onSubmit: props.onSubmit } : {})}
      {...(props.onCancel ? { onCancel: props.onCancel } : {})}
      onKeyDown={(event) => {
        // ⌘⌥0 to ⌘⌥6: text, or a heading of that level
        const level = /^Digit([0-6])$/.exec(event.code)?.[1]
        if (flavor === 'full' && level && (event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey) {
          event.preventDefault()
          editPlain((value, start, end) => plainHeading(value, start, end, Number(level)))
          return
        }
        const action = plainShortcut(event)
        if (action && (flavor === 'full' || ['bold', 'italic', 'strike', 'code', 'link'].includes(action))) {
          event.preventDefault()
          if (action === 'link') {
            openLink()
          } else {
            editPlain(action)
          }
        }
      }}
    />
  )

  const standIn = <StandIn value={props.value} placeholder={props.placeholder} />

  return (
    <div
      ref={root}
      className={['md-editor', `is-${flavor}`, props.className].filter(Boolean).join(' ')}
      style={{ '--md-editor-rows': props.rows ?? 3 } as CSSProperties}
    >
      <EditorOwner.Provider value={owner}>
        <Toolbar
          flavor={flavor}
          active={plain ? NOWHERE.active : selection.active}
          disabled={plain ? NOWHERE.disabled : selection.disabled}
          why={plain ? {} : selection.why}
          inTable={!plain && selection.inTable}
          markdown={markdown}
          onMarkdown={switchTo}
          onAction={act}
          heading={plain ? null : selection.heading}
          onHeading={(level) => {
            if (plain) {
              editPlain((value, start, end) => plainHeading(value, start, end, level))
            } else if (!selection.disabled.has('heading')) {
              rich?.heading(level)
            }
          }}
          onInsertTable={(columns, rows) =>
            plain
              ? editPlain((value, start, end) => plainTable(value, start, end, columns, rows))
              : rich?.insertTable(columns, rows)
          }
          tableOff={plain ? NOWHERE.tableOff : selection.tableOff}
          onTable={(op: TableOp) => rich?.table(op)}
          onRefocus={refocus}
          link={{
            open: linking !== null,
            text: linking?.text ?? '',
            href: linking?.href ?? null,
            at: linking?.at ?? null,
            onOpen: (open, away) => {
              if (open) {
                openLink()
                return
              }
              setLinking(null)
              refocus(away)
            },
            onApply: (href, text) => {
              setLinking(null)
              rich?.hold(false)
              if (plain) {
                if (href !== null) {
                  editPlain((value, start, end) => plainLink(value, start, end, text, href))
                }
              } else {
                rich?.link(href, text)
              }
            },
          }}
        />
        {markdown ? (
          box
        ) : (
          <Suspense fallback={standIn}>
            {!rich && standIn}
            <RichSurface
              hidden={!rich}
              value={props.value}
              onChange={props.onChange}
              flavor={flavor}
              label={props.label}
              placeholder={props.placeholder}
              onSubmit={props.onSubmit}
              onCancel={props.onCancel}
              onLink={openLink}
              onContextMenu={(at, here) => setContext({ ...at, ...here })}
              onSelection={setSelection}
              onReady={setRich}
            />
          </Suspense>
        )}
        <ContextMenu
          at={context}
          onClose={() => {
            setContext(null)
            rich?.focus()
          }}
          tableOff={selection.tableOff}
          onTable={(op) => rich?.table(op)}
          // once the menu has closed and given focus back
          onEditLink={() => setTimeout(openLink)}
          onRemoveLink={() => rich?.link(null)}
          onSource={() => switchTo(true)}
        />
      </EditorOwner.Provider>
      {props.footer && <div className="md-editor-foot">{props.footer}</div>}
    </div>
  )
}

/** Until the rich side is drawn: the text as it will look, not to be typed in yet. */
function StandIn({ value, placeholder }: { value: string; placeholder?: string | undefined }) {
  return (
    <div className="md-editor-standin" aria-hidden="true">
      {value.trim() ? (
        <MarkdownView tree={markdownTree(value)} variant="compact" />
      ) : (
        <p className="md-editor-standin-placeholder">{placeholder}</p>
      )}
    </div>
  )
}
