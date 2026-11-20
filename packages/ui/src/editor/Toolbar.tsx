// The editor's toolbar: GitHub's buttons, in GitHub's order, with Table at the end and the switch to
// the Markdown source (View Markdown source) at the right. One tab stop, with the arrow keys between its buttons. Where the box is too
// narrow for them all (the comments column), five stay and the rest go under More, with their keys.
//
// It drives either side of the switch: the rich editor, or the Markdown in the plain box.
import { Menu } from '@base-ui/react/menu'
import { Popover } from '@base-ui/react/popover'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Button } from '../controls/Button.tsx'
import { usePopupTag } from './owner.ts'
import { TextField } from '../controls/TextField.tsx'
import type { Action, Flavor, TableOp } from './milkdown.ts'

interface ActionInfo {
  label: string
  /** Its keys, as the design writes them: ⌘ for the Mac's Command, or Ctrl elsewhere. */
  keys?: string
  icon: ReactNode
}

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
)

export const ACTIONS: Record<Action, ActionInfo> = {
  bold: { label: 'Bold', keys: '⌘B', icon: <b className="md-editor-glyph is-bold">B</b> },
  italic: { label: 'Italic', keys: '⌘I', icon: <i className="md-editor-glyph is-italic">I</i> },
  strike: { label: 'Strikethrough', keys: '⌘⇧X', icon: <s className="md-editor-glyph">S</s> },
  heading: { label: 'Heading', icon: <b className="md-editor-glyph is-bold">H</b> },
  quote: {
    label: 'Quote',
    keys: '⌘⇧.',
    icon: svg(
      <>
        <path d="M5 5v14" />
        <path d="M10 7h9M10 12h9M10 17h6" />
      </>,
    ),
  },
  code: { label: 'Code', keys: '⌘E', icon: svg(<path d="m8 7-5 5 5 5M16 7l5 5-5 5" />) },
  link: {
    label: 'Link',
    keys: '⌘K',
    icon: svg(
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>,
    ),
  },
  bullets: {
    label: 'Bulleted list',
    keys: '⌘⇧8',
    icon: svg(
      <>
        <path d="M9 6h12M9 12h12M9 18h12" />
        <circle cx="4" cy="6" r="1" fill="currentColor" />
        <circle cx="4" cy="12" r="1" fill="currentColor" />
        <circle cx="4" cy="18" r="1" fill="currentColor" />
      </>,
    ),
  },
  numbers: {
    label: 'Numbered list',
    keys: '⌘⇧7',
    icon: svg(
      <>
        <path d="M10 6h11M10 12h11M10 18h11" />
        <path d="M3.5 4.5 5 4v5M3.5 9h3" strokeWidth="1.6" />
        <path d="M3.5 15.2c.3-.8 2.6-1 2.6.4 0 1-1.6 1.7-2.7 3.4h3" strokeWidth="1.6" />
      </>,
    ),
  },
  tasks: {
    label: 'Task list',
    icon: svg(
      <>
        <rect x="3" y="5" width="6" height="6" rx="1" />
        <path d="m4.3 8 1.2 1.2 2.2-2.4" strokeWidth="1.6" />
        <rect x="3" y="14" width="6" height="6" rx="1" />
        <path d="M13 8h8M13 17h8" />
      </>,
    ),
  },
  table: {
    label: 'Table',
    icon: svg(
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M3 15h18M10 4v16" />
      </>,
    ),
  },
}

const MORE_ICON = svg(
  <>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </>,
)

// the switch to the source: the Markdown mark (M and a down arrow), unlike the HTML mark's </>. Its
// name stays the same, pressed or not; its tooltip says where a press goes
export const SOURCE_LABEL = 'View Markdown source'
const MARKDOWN_ICON = (
  <svg viewBox="0 0 208 128" width="20" height="13" aria-hidden>
    <rect x="5" y="5" width="198" height="118" rx="10" fill="none" stroke="currentColor" strokeWidth="12" />
    <path d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0-30-33h20V30h20v35h20z" fill="currentColor" />
  </svg>
)

// the full box's buttons in groups, and the five kept when it's narrow
const FULL: Action[][] = [
  ['bold', 'italic', 'strike'],
  ['heading', 'quote', 'code', 'link'],
  ['bullets', 'numbers', 'tasks'],
  ['table'],
]
const INLINE: Action[][] = [['bold', 'italic', 'strike', 'code', 'link']]
const NARROW = new Set<Action>(['bold', 'italic', 'code', 'link', 'bullets'])

// the table menu's icons: where a row or column goes (a plus), how a column lines up, what's deleted (a cross)
const TABLE_ICONS: Record<TableOp, ReactNode> = {
  'row-above': svg(
    <>
      <rect x="3" y="11" width="18" height="10" rx="1.5" />
      <path d="M3 16h18M12 2v6M9 5h6" />
    </>,
  ),
  'row-below': svg(
    <>
      <rect x="3" y="3" width="18" height="10" rx="1.5" />
      <path d="M3 8h18M12 16v6M9 19h6" />
    </>,
  ),
  'column-left': svg(
    <>
      <rect x="11" y="3" width="10" height="18" rx="1.5" />
      <path d="M16 3v18M2 12h6M5 9v6" />
    </>,
  ),
  'column-right': svg(
    <>
      <rect x="3" y="3" width="10" height="18" rx="1.5" />
      <path d="M8 3v18M16 12h6M19 9v6" />
    </>,
  ),
  'align-left': svg(<path d="M4 6h16M4 10h10M4 14h16M4 18h10" />),
  'align-center': svg(<path d="M4 6h16M7 10h10M4 14h16M7 18h10" />),
  'align-right': svg(<path d="M4 6h16M10 10h10M4 14h16M10 18h10" />),
  'delete-row': svg(
    <>
      <rect x="3" y="7" width="18" height="10" rx="1.5" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </>,
  ),
  'delete-column': svg(
    <>
      <rect x="7" y="3" width="10" height="18" rx="1.5" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </>,
  ),
  'delete-table': svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m8.5 8.5 7 7M15.5 8.5l-7 7" />
    </>,
  ),
}

const TABLE_OPS: Array<{ label: string; ops: Array<[TableOp, string]> }> = [
  {
    label: 'Insert',
    ops: [
      ['row-above', 'Row above'],
      ['row-below', 'Row below'],
      ['column-left', 'Column to the left'],
      ['column-right', 'Column to the right'],
    ],
  },
  {
    label: 'Align the column',
    ops: [
      ['align-left', 'Left'],
      ['align-center', 'Center'],
      ['align-right', 'Right'],
    ],
  },
  {
    label: 'Delete',
    ops: [
      ['delete-row', 'Row'],
      ['delete-column', 'Column'],
      ['delete-table', 'Table'],
    ],
  },
]

// ⌘ on a Mac, Ctrl elsewhere
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const keysFor = (keys: string) =>
  MAC ? keys : keys.replace('⌘', 'Ctrl+').replace('⌥', 'Alt+').replace('⇧', 'Shift+')
const aria = (keys: string) =>
  keys
    .replace('⌘', MAC ? 'Meta+' : 'Control+')
    .replace('⌥', 'Alt+')
    .replace('⇧', 'Shift+')

// the heading menu: back to text, or a level, each with Milkdown's keys for it
const LEVELS: Array<[number, string]> = [
  [0, 'Normal text'],
  [1, 'Heading 1'],
  [2, 'Heading 2'],
  [3, 'Heading 3'],
  [4, 'Heading 4'],
  [5, 'Heading 5'],
  [6, 'Heading 6'],
]

function LevelItems({ current, onHeading }: { current: number | null; onHeading: (level: number) => void }) {
  return (
    <>
      {LEVELS.map(([level, label]) => (
        <Menu.Item key={level} className="md-editor-menu-item" onClick={() => onHeading(level)}>
          <span className="md-editor-menu-check" aria-hidden>
            {current === level ? '✓' : ''}
          </span>
          <span className={level > 0 ? `md-editor-level is-h${level}` : undefined}>{label}</span>
          {current === level && <span className="visually-hidden"> (now)</span>}
          <kbd>{keysFor(`⌘⌥${level}`)}</kbd>
        </Menu.Item>
      ))}
    </>
  )
}

export interface ToolbarProps {
  flavor: Flavor
  /** Lit buttons: where the caret is in the rich editor. None on the Markdown side. */
  active: Set<Action>
  /** Greyed-out buttons: what can't be done where the caret is, and why ("not in a code block"). */
  disabled: Set<Action>
  why: Partial<Record<Action, string>>
  /** The caret's in a table: the table button opens the table's menu. */
  inTable: boolean
  /** The Markdown side is showing. */
  markdown: boolean
  onMarkdown: (on: boolean) => void
  onAction: (action: Action) => void
  /** The level of the heading the caret's in (0 in text), or null where that isn't known (the Markdown side). */
  heading: number | null
  /** The caret's block made a heading of this level, or text with 0. */
  onHeading: (level: number) => void
  /** A new table, of the size picked. Rows count the header. */
  onInsertTable: (columns: number, rows: number) => void
  onTable: (op: TableOp) => void
  /** In a table, what its menu can't do where the caret is. */
  tableOff: Set<TableOp>
  /** The link box: open, what its fields start as, where it opens (under its button with null), and what it does. */
  link: {
    open: boolean
    text: string
    href: string | null
    at: DOMRect | null
    /** Opened or closed; closed by focus going elsewhere (a press, Tab), which is left where it went. */
    onOpen: (open: boolean, away: boolean) => void
    onApply: (href: string | null, text: string) => void
  }
  /** A popup closed with nothing chosen: focus back to the text, unless it went somewhere of its own. */
  onRefocus: (away: boolean) => void
}

export function Toolbar(props: ToolbarProps) {
  const tag = usePopupTag()
  const groups = props.flavor === 'inline' ? INLINE : FULL
  const narrow = props.flavor === 'full'
  const hidden = groups.flat().filter((a) => narrow && !NARROW.has(a))
  // the one button that takes Tab; the arrow keys move it
  const [current, setCurrent] = useState<string>('bold')
  // the table size picker, open under the button it was opened from
  const [picking, setPicking] = useState<HTMLElement | null>(null)
  const more = useRef<HTMLButtonElement>(null)
  const roving = (id: string) => ({
    tabIndex: current === id ? 0 : -1,
    'data-tool': id,
    onFocus: () => setCurrent(id),
  })
  // a plain button keeps the editor focused, and its selection, while it's pressed (a menu's or the
  // link box's trigger doesn't: Base UI opens them on the press)
  const keepFocus = { onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault() }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    // React brings keys up from the toolbar's popups (the size picker, the link box) too: not theirs to move
    if (!keys.includes(event.key) || !event.currentTarget.contains(event.target as Node)) {
      return
    }
    const tools = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-tool]')].filter(
      (tool) => tool.offsetParent !== null,
    )
    const at = tools.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tools.length - 1
          : (at + (event.key === 'ArrowRight' ? 1 : -1) + tools.length) % tools.length
    event.preventDefault()
    tools[next]?.focus()
  }

  const button = (action: Action) => {
    const info = ACTIONS[action]
    const on = props.active.has(action)
    // greyed out, but still in the toolbar's keyboard path, saying why
    const off = props.disabled.has(action)
    const common = {
      ...roving(action),
      className: `md-editor-tool${on ? ' is-on' : ''}${narrow && !NARROW.has(action) ? ' is-wide-only' : ''}`,
      'aria-label': info.label,
      'aria-keyshortcuts': info.keys ? aria(info.keys) : undefined,
      'aria-disabled': off || undefined,
      title: off
        ? `${info.label}: ${props.why[action] ?? 'not here'}`
        : info.keys
          ? `${info.label} (${keysFor(info.keys)})`
          : info.label,
    }
    if (action === 'link') {
      return <LinkTool key={action} {...props.link} trigger={common} icon={info.icon} on={on} off={off} />
    }
    if (action === 'heading' && !off) {
      return (
        <Menu.Root key={action}>
          <Menu.Trigger {...common} type="button">
            {info.icon}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="md-editor-menu-positioner" align="start" sideOffset={4}>
              <Menu.Popup {...tag} className="md-editor-menu">
                <LevelItems current={props.heading} onHeading={props.onHeading} />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )
    }
    if (action === 'table' && props.inTable && !props.markdown) {
      return (
        <Menu.Root key={action}>
          <Menu.Trigger {...common} aria-label="Table: change it" type="button">
            {info.icon}
          </Menu.Trigger>
          <TableMenu onTable={props.onTable} off={props.tableOff} />
        </Menu.Root>
      )
    }
    return (
      <button
        key={action}
        type="button"
        {...common}
        {...keepFocus}
        aria-pressed={props.markdown || action === 'table' ? undefined : on}
        aria-haspopup={action === 'table' ? 'dialog' : undefined}
        onClick={(event) => {
          if (off) {
            return
          }
          if (action === 'table') {
            setPicking(event.currentTarget)
          } else {
            props.onAction(action)
          }
        }}
      >
        {info.icon}
      </button>
    )
  }

  return (
    <div className="md-editor-bar" role="toolbar" aria-label="Formatting" onKeyDown={onKeyDown}>
      {groups.map((group, i) => (
        <span key={i} className="md-editor-group">
          {i > 0 && (
            <span className={`md-editor-sep${narrow && group.every((a) => !NARROW.has(a)) ? ' is-wide-only' : ''}`} />
          )}
          {group.map(button)}
        </span>
      ))}
      {hidden.length > 0 && (
        <Menu.Root>
          <span className="md-editor-sep is-narrow-only" />
          <Menu.Trigger
            ref={more}
            {...roving('more')}
            className="md-editor-tool is-narrow-only"
            aria-label="More formatting"
            type="button"
          >
            {MORE_ICON}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="md-editor-menu-positioner" align="start" sideOffset={4}>
              <Menu.Popup {...tag} className="md-editor-menu">
                {hidden.map((action) =>
                  action === 'table' && props.inTable && !props.markdown ? (
                    <TableItems key={action} onTable={props.onTable} off={props.tableOff} />
                  ) : action === 'heading' && !props.disabled.has('heading') ? (
                    <Menu.SubmenuRoot key={action}>
                      <Menu.SubmenuTrigger className="md-editor-menu-item">
                        <span className="md-editor-menu-icon">{ACTIONS.heading.icon}</span>
                        <span>{ACTIONS.heading.label}</span>
                        <span className="md-editor-menu-more" aria-hidden>
                          ›
                        </span>
                      </Menu.SubmenuTrigger>
                      <Menu.Portal>
                        <Menu.Positioner className="md-editor-menu-positioner" sideOffset={4}>
                          <Menu.Popup {...tag} className="md-editor-menu">
                            <LevelItems current={props.heading} onHeading={props.onHeading} />
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.SubmenuRoot>
                  ) : (
                    <Menu.Item
                      key={action}
                      disabled={props.disabled.has(action)}
                      className="md-editor-menu-item"
                      onClick={() =>
                        action === 'table'
                          ? // once the menu has closed and given focus back
                            setTimeout(() => setPicking(more.current))
                          : props.onAction(action)
                      }
                    >
                      <span className="md-editor-menu-icon">{ACTIONS[action].icon}</span>
                      <span>{ACTIONS[action].label}</span>
                      {ACTIONS[action].keys && <kbd>{keysFor(ACTIONS[action].keys!)}</kbd>}
                    </Menu.Item>
                  ),
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
      <TablePicker
        anchor={picking}
        onClose={(away) => {
          setPicking(null)
          props.onRefocus(away)
        }}
        onPick={(columns, rows) => {
          setPicking(null)
          props.onInsertTable(columns, rows)
        }}
      />
      <span className="md-editor-grow" />
      <button
        type="button"
        {...roving('markdown')}
        {...keepFocus}
        className={`md-editor-tool md-editor-switch${props.markdown ? ' is-on' : ''}`}
        aria-label={SOURCE_LABEL}
        title={props.markdown ? 'View formatted text' : SOURCE_LABEL}
        aria-pressed={props.markdown}
        onClick={() => props.onMarkdown(!props.markdown)}
      >
        {MARKDOWN_ICON}
      </button>
    </div>
  )
}

/**
 * Whether a popup closed because focus went elsewhere: a press outside it, or Tab out of it. Focus is
 * left where it went then; pulling it back to the text would put the old caret back under the press.
 */
const movedAway = (reason: string) => reason === 'outside-press' || reason === 'focus-out'

// the picker's grid: up to this many columns and rows
const PICKER = 8

/** Picks a new table's size from a grid, by pointer or arrow keys. Rows count the header, so there are at least two. */
function TablePicker(props: {
  anchor: HTMLElement | null
  /** Closed with nothing picked; by focus going elsewhere (a press, Tab), which is left where it went. */
  onClose: (away: boolean) => void
  onPick: (columns: number, rows: number) => void
}) {
  const tag = usePopupTag()
  const [size, setSize] = useState({ columns: 3, rows: 3 })
  const grid = useRef<HTMLDivElement>(null)
  const hint = useId()
  const fit = (columns: number, rows: number) => ({
    columns: Math.min(PICKER, Math.max(1, columns)),
    rows: Math.min(PICKER, Math.max(2, rows)),
  })
  // each time it opens: three by three, a header and two rows
  useEffect(() => {
    if (props.anchor) {
      setSize({ columns: 3, rows: 3 })
    }
  }, [props.anchor])
  const moves: Record<string, [number, number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
  }
  return (
    <Popover.Root
      open={props.anchor !== null}
      onOpenChange={(open, details) => {
        if (!open) {
          props.onClose(movedAway(details.reason))
        }
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={props.anchor}
          className="md-editor-menu-positioner"
          side="bottom"
          align="start"
          sideOffset={4}
        >
          <Popover.Popup
            {...tag}
            className="md-editor-table-picker"
            aria-label="Insert a table"
            initialFocus={grid}
            finalFocus={false}
          >
            <div
              ref={grid}
              className="md-editor-table-grid"
              role="group"
              tabIndex={0}
              aria-label="Table size"
              aria-describedby={hint}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  props.onPick(size.columns, size.rows)
                  return
                }
                const move = moves[event.key]
                if (move) {
                  event.preventDefault()
                  setSize((was) => fit(was.columns + move[0], was.rows + move[1]))
                }
              }}
            >
              {Array.from({ length: PICKER * PICKER }, (_, i) => {
                const column = (i % PICKER) + 1
                const row = Math.floor(i / PICKER) + 1
                const on = column <= size.columns && row <= size.rows
                return (
                  <span
                    key={i}
                    className={`md-editor-table-cell${on ? ' is-on' : ''}${row === 1 ? ' is-head' : ''}`}
                    onMouseEnter={() => setSize(fit(column, row))}
                    onClick={() => {
                      const picked = fit(column, row)
                      props.onPick(picked.columns, picked.rows)
                    }}
                  />
                )
              })}
            </div>
            <p className="md-editor-table-size" aria-live="polite">
              {size.columns} {size.columns === 1 ? 'column' : 'columns'}, {size.rows} rows
            </p>
            <p id={hint} className="md-editor-table-hint">
              The first row is the header. Arrow keys pick the size; Enter adds the table.
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function TableMenu({ onTable, off }: { onTable: (op: TableOp) => void; off: Set<TableOp> }) {
  const tag = usePopupTag()
  return (
    <Menu.Portal>
      <Menu.Positioner className="md-editor-menu-positioner" align="start" sideOffset={4}>
        <Menu.Popup {...tag} className="md-editor-menu">
          <TableItems onTable={onTable} off={off} />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

/** The table's menu: insert, align, delete; greyed out where it can't apply (`off`). */
export function TableItems({ onTable, off }: { onTable: (op: TableOp) => void; off: Set<TableOp> }) {
  return (
    <>
      {TABLE_OPS.map((group, i) => (
        <Menu.Group key={group.label}>
          {i > 0 && <Menu.Separator className="md-editor-menu-rule" />}
          <Menu.GroupLabel className="md-editor-menu-label">{group.label}</Menu.GroupLabel>
          {group.ops.map(([op, label]) => (
            <Menu.Item
              key={op}
              disabled={off.has(op)}
              className={`md-editor-menu-item${op.startsWith('delete') ? ' is-danger' : ''}`}
              onClick={() => onTable(op)}
            >
              <span className="md-editor-menu-icon">{TABLE_ICONS[op]}</span>
              {label}
            </Menu.Item>
          ))}
        </Menu.Group>
      ))}
    </>
  )
}

interface LinkToolProps {
  open: boolean
  /** Greyed out: the box doesn't open. */
  off: boolean
  /** What the fields start as: the selected text, and the link it's in (null for a new one). */
  text: string
  href: string | null
  /** Where it opens: the selected text's place on the screen, or under the button with null. */
  at: DOMRect | null
  onOpen: (open: boolean, away: boolean) => void
  onApply: (href: string | null, text: string) => void
  trigger: Record<string, unknown>
  icon: ReactNode
  on: boolean
}

/** The link button and its box: the link's text and address, then Add (or Change) and Remove. */
function LinkTool({ open, off, text, href, at, onOpen, onApply, trigger, icon, on }: LinkToolProps) {
  const tag = usePopupTag()
  const [words, setWords] = useState('')
  const [address, setAddress] = useState('')
  // each time it opens: the selected text, and the address of the link it's in
  useEffect(() => {
    if (open) {
      setWords(text)
      setAddress(href ?? '')
    }
  }, [open, text, href])
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next && off) {
          return
        }
        onOpen(next, movedAway(details.reason))
      }}
    >
      <Popover.Trigger {...trigger} aria-pressed={on} type="button">
        {icon}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="md-editor-menu-positioner"
          {...(at ? { anchor: { getBoundingClientRect: () => at } } : {})}
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Popover.Popup {...tag} className="md-editor-link" aria-label="Link" finalFocus={false}>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                // React passes a portal's events up its own tree: without this, the box's form (a
                // comment's, a review's) would be sent too
                event.stopPropagation()
                if (address.trim()) {
                  onApply(address.trim(), words)
                }
              }}
            >
              <TextField label="Text" value={words} onChange={setWords} placeholder="The address, if left empty" />
              <TextField label="Link address" value={address} onChange={setAddress} placeholder="https://" autoFocus />
              <span className="md-editor-link-buttons">
                {href && (
                  <Button size="sm" variant="ghost" type="button" onClick={() => onApply(null, words)}>
                    Remove link
                  </Button>
                )}
                <Button size="sm" variant="primary" type="submit" disabled={!address.trim()}>
                  {href ? 'Change' : 'Add link'}
                </Button>
              </span>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
