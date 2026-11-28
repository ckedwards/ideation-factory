// The focus view: an idea's files with everything else out of the way. Each
// file is a page on a sheet of its own, one under the other in one scroll, with
// the pages' names down the left. Comments are hidden until asked for: then
// either only the one selected (its highlight clicked) sits beside its text, or
// every open thread does, fitted to the room as on the Files tab (CommentGutter),
// and they can be acted on there too. Getting in and out carries the text you were reading
// between the Files tab and its sheet, so it never jumps or shows twice.
//
// It's drawn over the whole window, above the app's bar and the idea's, with
// the page beneath inert. IdeaView says when it's opening, open, or leaving.
//
// Edit (or Open the draft) in its top line opens the idea's draft: every sheet
// becomes its file in the editor, and the column on the right shows the draft's
// changes, Commit, Preview and Discard in place of the comments. It saves as you
// go, so leaving asks nothing: what's typed is saved first, and the editor shut.
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { markdownTree } from '@ideaf/core'
import {
  type FileState,
  type RowMenuItem,
  Button,
  type CardSize,
  CommentGutter,
  defaultResolveLink,
  headings,
  MarkdownView,
  renderMermaid,
  SegmentedControl,
  SelectionMenu,
  stateHint,
  type TextSelection,
} from '@ideaf/ui'
import { type PageComment, type ThreadActions, ThreadCard } from './ThreadCard.tsx'
import { CommentBox } from './CommentBox.tsx'
import { FileLine } from './FileLine.tsx'
import './FocusView.css'

/** How the comments show: not at all, only the one selected, or all of them as the Files tab has them. */
export type FocusComments = 'off' | 'selected' | 'all'

/** still: open from the start (its address opened directly), nothing to carry from. */
export type FocusPhase = 'still' | 'entering' | 'open' | 'leaving'

/** Editing the idea's draft here: the button that opens it, and, open, each sheet's editor and the actions. */
export interface FocusEditing {
  /** "Edit", or "Open the draft" when it has changes. */
  label: string
  /** The draft not read yet. */
  disabled?: boolean
  onEdit: () => void
  /** The draft, open for editing; null while it isn't. */
  open: {
    /** "Editing the draft, on v3". */
    label: string
    /** The faces of who else is in the draft. */
    people?: ReactNode
    /** A page's file in the editor (or compared, previewing); null for one the draft hasn't got. */
    sheet: (page: string) => ReactNode
    /** The draft's changes (a dialog), Commit, Preview, Discard and Close editor: in the top line. */
    actions: ReactNode
    /** What's typed saved, then the editor closed; false if something couldn't be saved. */
    close: () => Promise<boolean>
  } | null
}

/** One file, one page: its open comments, placed in it. */
export interface FocusPage {
  id: string
  path: string
  /** What the draft does to its file, while it's in use: as the Files tree says. */
  state?: FileState | null
  /** Its path in the latest version, when the draft renames it. */
  was?: string | null
  source: string
  comments: PageComment[]
}

export interface FocusViewProps {
  title: string
  /** "v1 · 22h ago" */
  version: ReactNode
  pages: FocusPage[]
  /** The file the Files tab shows: what entering carries from, and leaving carries to. */
  file: string
  phase: FocusPhase
  /** Exit or Esc: the file whose page is at the top. */
  onExit: (path: string) => void
  /** Entering's done. */
  onOpened: () => void
  /** Leaving's done: focus view can go. */
  onLeft: () => void
  actions: ThreadActions
  /** What a suggestion there replaces, in a page's file. */
  suggestionOf?: (page: string, selection: TextSelection) => string | null
  onComment?: (page: string, selection: TextSelection, body: string, pending: boolean) => void
  onSuggest?: (page: string, selection: TextSelection, replacement: string, body: string, pending: boolean) => void
  /** A comment on a page's file as a whole, from the button in its header. */
  onFileComment?: (page: string, body: string, pending: boolean) => void
  /** For those who can edit the latest version: its draft, here. */
  editing?: FocusEditing
  /** Making a file: in the top line, as there's no Files list here. */
  onNewFile?: () => void
  /** Each page's file's own ⋯, on its line. */
  fileMenu?: (page: string) => RowMenuItem[] | undefined
}

const DURATION = 300
const EASE = 'cubic-bezier(.4, 0, .2, 1)'
// how far the text can be carried; further, and its sheet fades in place
const CARRY = 600
// the page and heading being read are the last whose top is above this line
const SPY = 140

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
// the Files tab's text, which entering carries from and leaving carries to
const filesText = () => document.querySelector<HTMLElement>('.idea-page-measure .prose')
const filesScroller = () => document.querySelector<HTMLElement>('.idea-page-document')
// the page beneath, out of reach while focus view's open
const BENEATH = ['.app-shell-bar', '.app-shell-nav', '.idea-bar', '.idea-frame-tabs', '.idea-page']

export function FocusView(props: FocusViewProps) {
  const { pages, phase } = props
  const root = useRef<HTMLDivElement>(null)
  const sheets = useRef(new Map<string, HTMLElement>())
  const rows = useRef(new Map<string, HTMLElement>())
  const running = useRef<Animation[]>([])
  // focus view's own look: open (the ground, the sheets in place) and comments on
  const [open, setOpen] = useState(phase === 'still')
  const [mode, setMode] = useState<FocusComments>('off')
  // editing, the comments are put away: the draft's actions are in the top line
  const editing = props.editing?.open ?? null
  const comments = mode !== 'off' && editing === null
  // no transitions for a change that's measured, not shown (comments off on the way out)
  const [still, setStill] = useState(phase === 'still')
  // the page whose text is carried in: in place from the first frame, not rising with the others
  const [carried, setCarried] = useState<string | null>(() =>
    phase === 'entering' ? ((pages.find((p) => p.path === props.file) ?? pages[0])?.id ?? null) : null,
  )
  const [active, setActive] = useState<string | null>(null)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [current, setCurrent] = useState<{ page: string; heading: string | null }>({
    page: pages.find((p) => p.path === props.file)?.id ?? pages[0]?.id ?? '',
    heading: null,
  })
  const trees = useMemo(() => new Map(pages.map((p) => [p.id, markdownTree(p.source)])), [pages])
  const count = pages.reduce((n, p) => n + p.comments.length, 0)
  const latest = useRef(props)
  latest.current = props

  const cancel = () => {
    for (const animation of running.current) {
      animation.cancel()
    }
    running.current = []
  }

  // the page beneath steps back: its bars and columns leave (FocusView.css), it can't be reached, and
  // its text is handed to focus view's sheet
  useLayoutEffect(() => {
    const html = document.documentElement
    html.classList.add('focus-motion')
    const beneath = BENEATH.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
    for (const element of beneath) {
      element.inert = true
    }
    return () => {
      html.classList.remove('focus-motion')
      delete html.dataset['focus']
      for (const element of beneath) {
        element.inert = false
      }
    }
  }, [])
  useLayoutEffect(() => {
    if (open) {
      document.documentElement.dataset['focus'] = 'open'
    } else {
      delete document.documentElement.dataset['focus']
    }
  }, [open])

  // entering: focus view scrolled to the text being read, its sheet put where that text is now, and
  // carried home as everything else arrives
  useLayoutEffect(() => {
    const scroller = root.current
    if (!scroller) {
      return
    }
    if (phase === 'still') {
      // opened at its address: on its file, at once
      const row = rows.current.get(current.page)
      if (row) {
        scroller.scrollTop = row.offsetTop - remToPx(4.25)
      }
      scroller.focus({ preventScroll: true })
      return
    }
    if (phase !== 'entering') {
      return
    }
    const page = pages.find((p) => p.path === props.file) ?? pages[0]
    const sheet = page && sheets.current.get(page.id)
    const to = sheet?.querySelector<HTMLElement>('.prose')
    const from = filesText()
    if (sheet && to && from) {
      // as far down the file as the Files tab was
      scroller.scrollTop += to.getBoundingClientRect().top - from.getBoundingClientRect().top
    }
    scroller.focus({ preventScroll: true })
    // the starting look is drawn before the change, so the change is a transition
    void scroller.offsetHeight
    setOpen(true)
    if (!sheet || !to || !from || reduced()) {
      setCarried(null)
      return
    }
    const a = from.getBoundingClientRect()
    const b = to.getBoundingClientRect()
    if (Math.abs(a.top - b.top) > CARRY) {
      // too far: it fades in with the others
      setCarried(null)
      return
    }
    running.current.push(
      sheet.animate(
        [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, ...BARE }, { transform: 'none' }],
        {
          duration: DURATION,
          easing: EASE,
        },
      ),
      ...[...sheet.querySelectorAll('.focus-sheet-head')].map((head) =>
        head.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: 'ease' }),
      ),
    )
  }, [])
  useEffect(() => {
    if (phase !== 'entering') {
      return
    }
    const done = window.setTimeout(() => {
      setCarried(null)
      latest.current.onOpened()
    }, DURATION)
    return () => window.clearTimeout(done)
  }, [phase])

  // leaving: comments off at once, the Files tab scrolled to the text being read, and the sheet carried
  // there from wherever it's showing, losing its fill, as everything else leaves
  useLayoutEffect(() => {
    if (phase !== 'leaving') {
      return
    }
    const view = root.current
    cancel()
    const page = pages.find((p) => p.path === props.file)
    const sheet = page && sheets.current.get(page.id)
    const showing = sheet?.getBoundingClientRect()
    setStill(true)
    setMode('off')
    let carry: (() => void) | null = null
    if (view && sheet && showing && !reduced()) {
      carry = () => {
        const to = filesText()
        const text = sheet.querySelector<HTMLElement>('.prose')
        const scroller = filesScroller()
        if (!to || !text) {
          return
        }
        // the Files tab at the same place in the file, when it scrolls on its own
        if (scroller && getComputedStyle(scroller).overflowY === 'auto') {
          scroller.scrollTop += to.getBoundingClientRect().top - text.getBoundingClientRect().top
        }
        const a = to.getBoundingClientRect()
        const b = text.getBoundingClientRect()
        const home = sheet.getBoundingClientRect()
        if (Math.abs(a.top - b.top) > CARRY) {
          return
        }
        setCarried(page.id)
        running.current.push(
          sheet.animate(
            [
              { transform: `translate(${showing.left - home.left}px, ${showing.top - home.top}px)` },
              { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, ...BARE },
            ],
            { duration: DURATION, easing: EASE, fill: 'forwards' },
          ),
          ...[...sheet.querySelectorAll('.focus-sheet-head')].map((head) =>
            head.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION, fill: 'forwards' }),
          ),
        )
      }
    }
    // measured once comments are off and the sheet's back in the middle
    const frame = requestAnimationFrame(() => {
      carry?.()
      setOpen(false)
    })
    const done = window.setTimeout(() => latest.current.onLeft(), reduced() ? 0 : DURATION)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(done)
    }
  }, [phase])
  useLayoutEffect(() => {
    if (still && phase !== 'leaving' && phase !== 'still') {
      setStill(false)
    }
  }, [still, phase])
  useEffect(() => cancel, [])

  // which page and heading are being read
  useEffect(() => {
    const scroller = root.current
    if (!scroller) {
      return
    }
    const spy = () => {
      const line = scroller.getBoundingClientRect().top + SPY
      const order = latest.current.pages.flatMap((p) => {
        const row = rows.current.get(p.id)
        return row ? [{ id: p.id, row }] : []
      })
      // scrolled to the end, the last page is the one being read, however short it is
      const end = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      const at = end ? order.at(-1) : (order.findLast((p) => p.row.getBoundingClientRect().top <= line) ?? order[0])
      if (!at) {
        return
      }
      const heading = [...(sheets.current.get(at.id)?.querySelectorAll<HTMLElement>('.prose h2') ?? [])].findLast(
        (h) => h.getBoundingClientRect().top <= line,
      )
      const next = { page: at.id, heading: heading?.id ?? null }
      setCurrent((was) => (was.page === next.page && was.heading === next.heading ? was : next))
    }
    spy()
    scroller.addEventListener('scroll', spy, { passive: true })
    return () => scroller.removeEventListener('scroll', spy)
  }, [])

  // Esc leaves, once there's nothing smaller open to close first
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = event.target as HTMLElement | null
      if (target?.closest('textarea, input, select, [role="menu"], [role="dialog"]')) {
        return
      }
      if (document.querySelector('.selection-menu')) {
        return
      }
      if (pagesOpen) {
        setPagesOpen(false)
        return
      }
      exit()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  // after the last sheet, just the room its last heading needs to come to the top (as the page list
  // takes it there): the view's height, less the heading's margin and what follows it
  useEffect(() => {
    const view = root.current
    const list = view?.querySelector<HTMLElement>('.focus-pages')
    if (!view || !list) {
      return
    }
    const fit = () => {
      const rows = list.querySelectorAll<HTMLElement>('.focus-row')
      const row = rows[rows.length - 1]
      const headings = row?.querySelectorAll<HTMLElement>('.focus-sheet .prose :is(h1, h2, h3, h4, h5, h6)')
      const last = headings?.[headings.length - 1]
      if (!row || !last) {
        list.style.removeProperty('--scroll-past')
        return
      }
      const margin = parseFloat(getComputedStyle(last).scrollMarginTop) || 0
      // what scrolls after the heading's top, the room (the list's foot) aside: the rest of the sheets,
      // up to where the room starts
      const room = parseFloat(getComputedStyle(list).paddingBottom) || 0
      const after = list.getBoundingClientRect().bottom - room - last.getBoundingClientRect().top
      list.style.setProperty('--scroll-past', `${Math.max(remToPx(6), view.clientHeight - margin - after)}px`)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(list)
    // and once the sheets are still: they slide in as it opens, and move as the comments come and go
    view.addEventListener('transitionend', fit)
    const settled = window.setTimeout(fit, DURATION + 50)
    return () => {
      observer.disconnect()
      view.removeEventListener('transitionend', fit)
      window.clearTimeout(settled)
    }
  }, [open, mode])

  // editing: the sheets' toolbar pinned under the top line, as the Files page's is at the top of its
  // pane, as wide as a sheet: where both are, measured (FocusView.css)
  useLayoutEffect(() => {
    const view = root.current
    if (!view || editing === null) {
      return
    }
    const place = () => {
      const top = view.querySelector<HTMLElement>('.focus-top')
      const sheet = view.querySelector<HTMLElement>('.focus-sheet')
      if (!top || !sheet) {
        return
      }
      const line = top.getBoundingClientRect()
      const column = sheet.getBoundingClientRect()
      view.style.setProperty('--edit-top', `${line.bottom}px`)
      view.style.setProperty('--edit-left', `${column.left}px`)
      view.style.setProperty('--edit-width', `${column.width}px`)
      // the bar shown, as tall as it is (its status may wrap to a line of its own): the room the sheets
      // leave above them
      const bar = [...view.querySelectorAll<HTMLElement>('.focus-sheet .md-editor-bar')].find(
        (b) => b.getBoundingClientRect().height > 0,
      )
      if (bar) {
        view.style.setProperty('--edit-bar', `${bar.getBoundingClientRect().height}px`)
      }
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(view)
    // the sheets, which grow once their editors are in
    for (const sheet of view.querySelectorAll('.focus-sheet')) {
      observer.observe(sheet)
    }
    window.addEventListener('resize', place)
    // and once the sheets are still: they move as the comments go
    const settled = window.setTimeout(place, DURATION + 50)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.clearTimeout(settled)
    }
  }, [editing === null])

  const exit = () => {
    const page = latest.current.pages.find((p) => p.id === current.page)
    const leave = () => props.onExit(page?.path ?? props.file)
    // editing: what's typed saved and the editor shut first; leaving waits for it, and stays if it can't
    const open = latest.current.editing?.open
    if (open) {
      void open.close().then((ok) => ok && leave())
    } else {
      leave()
    }
  }
  const choose = (next: FocusComments) => {
    cancel()
    setStill(false)
    setMode(next)
  }
  const go = (id: string) => {
    setPagesOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
  }
  // the file changed while it's open (a file just made, or followed through a rename): to its page,
  // once it's there
  const goneTo = useRef(props.file)
  useEffect(() => {
    // open, whether it opened from the page ('open') or from its address ('still')
    if ((phase !== 'open' && phase !== 'still') || props.file === goneTo.current) {
      return
    }
    const at = pages.findIndex((p) => p.path === props.file)
    if (at >= 0) {
      goneTo.current = props.file
      requestAnimationFrame(() => go(rowId(at)))
    }
  })

  const actions: ThreadActions = props.actions

  const classes = [
    'focus-view',
    open && 'is-open',
    comments && 'has-comments',
    editing && 'is-editing',
    still && 'is-still',
    pagesOpen && 'has-pages-open',
  ]
  return createPortal(
    <div className={classes.filter(Boolean).join(' ')} ref={root} role="region" aria-label="Focus view" tabIndex={-1}>
      <div className="focus-top">
        <div className="focus-what">
          <button
            type="button"
            className="focus-pages-button"
            aria-expanded={pagesOpen}
            aria-controls="focus-nav"
            onClick={() => setPagesOpen(!pagesOpen)}
          >
            Pages
          </button>
          <span className="focus-title">{props.title}</span>
          <span className="focus-version">{props.version}</span>
        </div>
        <div className="focus-tools">
          {editing ? (
            <>
              {editing.people}
              <span className="focus-editing-label">{editing.label}</span>
              <span className="focus-edit-actions">{editing.actions}</span>
            </>
          ) : (
            props.editing && (
              <Button disabled={props.editing.disabled} onClick={props.editing.onEdit}>
                {props.editing.label}
              </Button>
            )
          )}
          {/* editing, no comments: the draft's actions are here instead */}
          {editing === null && (
            <span className="focus-comments">
              <span className="focus-comments-label">
                Comments <span className="focus-count">{count}</span>
              </span>
              <SegmentedControl
                label="Comments"
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'selected', label: 'Selected' },
                  { value: 'all', label: 'All' },
                ]}
                value={mode}
                onChange={choose}
              />
            </span>
          )}
          {props.onNewFile && (
            <Button variant="ghost" onClick={props.onNewFile}>
              New file
            </Button>
          )}
          <Button variant="ghost" onClick={exit}>
            Exit focus view <kbd aria-hidden>Esc</kbd>
          </Button>
        </div>
      </div>
      <nav className="focus-nav" id="focus-nav" aria-label="Pages">
        <ol className="focus-nav-in">
          {pages.map((page, i) => {
            const here = page.id === current.page
            return (
              <li key={page.id} className={`focus-nav-item${here ? ' is-current' : ''}`}>
                <a
                  href={`#${rowId(i)}`}
                  aria-current={here ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault()
                    go(rowId(i))
                  }}
                >
                  <span className="focus-nav-n">{i + 1}</span>
                  {/* as the Files tree marks it: the path's color, its tooltip and hidden words */}
                  <span
                    className={
                      page.state && page.state !== 'renamed' ? `focus-nav-path is-${page.state}` : 'focus-nav-path'
                    }
                    title={stateHint(page.state, page.was) ?? undefined}
                  >
                    {page.path}
                    {page.state && page.state !== 'renamed' && <span className="visually-hidden">, {page.state}</span>}
                  </span>
                </a>
                {here && (
                  <Sections
                    tree={trees.get(page.id)!}
                    prefix={prefixOf(i)}
                    comments={page.comments}
                    current={current.heading}
                    onGo={go}
                  />
                )}
              </li>
            )
          })}
        </ol>
      </nav>
      <div className="focus-pages">
        {pages.map((page, i) => (
          <Row
            key={page.id}
            index={i}
            of={pages.length}
            page={page}
            tree={trees.get(page.id)!}
            comments={comments}
            // editing, no comments beside the sheets
            mode={editing ? 'off' : mode}
            carried={carried === page.id}
            current={page.id === current.page}
            editor={editing ? editing.sheet(page.id) : null}
            menu={props.fileMenu?.(page.id)}
            active={active}
            onActive={setActive}
            actions={actions}
            rowRef={(element) => setIn(rows.current, page.id, element)}
            sheetRef={(element) => setIn(sheets.current, page.id, element)}
            {...(props.suggestionOf ? { suggestionOf: (s: TextSelection) => props.suggestionOf!(page.id, s) } : {})}
            {...(props.onComment
              ? { onComment: (s: TextSelection, body: string, p: boolean) => props.onComment!(page.id, s, body, p) }
              : {})}
            {...(props.onSuggest
              ? {
                  onSuggest: (s: TextSelection, r: string, body: string, p: boolean) =>
                    props.onSuggest!(page.id, s, r, body, p),
                }
              : {})}
            {...(props.onFileComment
              ? { onFileComment: (body: string, p: boolean) => props.onFileComment!(page.id, body, p) }
              : {})}
          />
        ))}
      </div>
    </div>,
    document.body,
  )
}

// the look a carried sheet has at the Files tab's end: the text alone
const BARE = { backgroundColor: 'transparent', borderColor: 'transparent', boxShadow: '0 0 0 transparent' }

const rowId = (i: number) => `focus-page-${i + 1}`
// each page's headings get IDs of their own, so two files' "Why" don't clash
const prefixOf = (i: number) => `focus-${i + 1}-`

/** The page being read's second-level headings, each with its count of open comments. */
function Sections(props: {
  tree: ReturnType<typeof markdownTree>
  prefix: string
  comments: PageComment[]
  current: string | null
  onGo: (id: string) => void
}) {
  const all = headings(props.tree, props.prefix)
  const twos = all.filter((h) => h.level === 2)
  if (twos.length === 0) {
    return null
  }
  return (
    <ol className="focus-nav-sections">
      {twos.map((heading) => {
        const end = all.find((h) => h.offset > heading.offset && h.level <= heading.level)?.offset ?? Infinity
        const open = props.comments.filter((c) => {
          const at = offsetOf(c)
          return at >= heading.offset && at < end
        }).length
        const here = heading.id === props.current
        return (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={here ? 'is-current' : undefined}
              aria-current={here ? 'location' : undefined}
              onClick={(event) => {
                event.preventDefault()
                props.onGo(heading.id)
              }}
            >
              <span>{heading.title}</span>
              {open > 0 && (
                <span className="focus-nav-count">
                  {open}
                  <span className="visually-hidden"> {open === 1 ? 'comment' : 'comments'}</span>
                </span>
              )}
            </a>
          </li>
        )
      })}
    </ol>
  )
}

interface RowProps {
  /** The page's file's own ⋯. */
  menu?: RowMenuItem[] | undefined
  index: number
  of: number
  page: FocusPage
  tree: ReturnType<typeof markdownTree>
  comments: boolean
  mode: FocusComments
  carried: boolean
  /** The page being read: editing, its toolbar's the one pinned, unless another's typed in. */
  current: boolean
  active: string | null
  onActive: (id: string) => void
  actions: ThreadActions
  rowRef: (element: HTMLElement | null) => void
  sheetRef: (element: HTMLElement | null) => void
  /** Editing: the page's file in the editor, in place of its text. */
  editor: ReactNode
  suggestionOf?: (selection: TextSelection) => string | null
  onComment?: (selection: TextSelection, body: string, pending: boolean) => void
  onSuggest?: (selection: TextSelection, replacement: string, body: string, pending: boolean) => void
  onFileComment?: (body: string, pending: boolean) => void
}

/** A page: its sheet, and its threads beside it. */
function Row(props: RowProps) {
  const { page, index, comments, active } = props
  const sheet = useRef<HTMLElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const prefix = prefixOf(index)
  const inText = page.comments.filter(
    (c) => c.place.kind === 'text' || c.place.kind === 'section' || c.place.kind === 'block',
  )
  // the box for a comment on the file, opened from its header
  const [fileBox, setFileBox] = useState(false)
  const commentable = comments && props.actions.canComment && props.onFileComment
  return (
    <div
      className={`focus-row${props.carried ? ' is-carried' : ''}${props.current ? ' is-current' : ''}`}
      id={rowId(index)}
      ref={props.rowRef}
      style={{ ['--row' as string]: index }}
    >
      <article
        className={`focus-sheet${props.editor ? ' is-editing' : ''}`}
        aria-labelledby={`${prefix}name`}
        ref={(element) => {
          sheet.current = element
          props.sheetRef(element)
        }}
      >
        <header className="focus-sheet-head">
          <span id={`${prefix}name`}>
            <FileLine
              path={page.path}
              count={page.comments.filter((c) => c.place.kind === 'file').length}
              onComment={commentable ? () => setFileBox(true) : undefined}
              menu={props.menu}
            />
          </span>
          <span className="focus-sheet-n">
            {index + 1} of {props.of}
          </span>
        </header>
        {fileBox && props.onFileComment && (
          <div className="focus-file-box">
            <CommentBox
              label="Comment on the whole file"
              addToReview={props.actions.addToReview ?? false}
              onComment={props.onFileComment}
              onCancel={() => setFileBox(false)}
            />
          </div>
        )}
        {props.editor ? (
          <div className="focus-editor">{props.editor}</div>
        ) : (
          <div ref={text}>
            {/* where the whole file's comments are, for the comments beside it: the top of the text */}
            <span className="focus-file-anchors" aria-hidden>
              {page.comments
                .filter((c) => c.place.kind === 'file')
                .map((c) => (
                  <span key={c.info.id} data-comment-id={c.info.id} />
                ))}
            </span>
            <MarkdownView
              tree={props.tree}
              idPrefix={prefix}
              // a link to one of the file's own headings, to its prefixed ID
              resolveLink={(url) =>
                url.startsWith('#') ? { href: `#${prefix}${url.slice(1)}`, kind: 'internal' } : defaultResolveLink(url)
              }
              marks={inText.flatMap((c) =>
                c.place.kind === 'text'
                  ? [{ id: c.info.id, start: c.place.start, end: c.place.end, active: c.info.id === active }]
                  : [],
              )}
              sectionMarks={inText.flatMap((c) =>
                c.place.kind === 'section'
                  ? [{ id: c.info.id, heading: c.place.heading, active: c.info.id === active }]
                  : [],
              )}
              blockMarks={inText.flatMap((c) =>
                c.place.kind === 'block' ? [{ id: c.info.id, block: c.place.start, active: c.info.id === active }] : [],
              )}
              renderCode={renderMermaid}
              onMarkClick={(id) => comments && props.onActive(id)}
            />
            <SelectionMenu
              documentRef={text}
              source={page.source}
              enabled={comments && props.actions.canComment}
              addToReview={props.actions.addToReview ?? false}
              {...(props.onComment ? { onComment: props.onComment } : {})}
              {...(props.onSuggest ? { onSuggest: props.onSuggest } : {})}
              {...(props.suggestionOf ? { suggestionOf: props.suggestionOf } : {})}
            />
          </div>
        )}
      </article>
      <SheetComments
        page={page}
        text={text}
        mode={props.mode}
        active={active}
        onActive={props.onActive}
        actions={props.actions}
      />
    </div>
  )
}

/**
 * A page's comments, beside its sheet: none, the one selected (with any others on its section or
 * block), or all of them, each level with its text and fitted to the room as on the Files tab. On a
 * narrow screen, listed under the sheet, each quoting what it's on.
 */
function SheetComments(props: {
  page: FocusPage
  text: RefObject<HTMLElement | null>
  mode: FocusComments
  active: string | null
  onActive: (id: string) => void
  actions: ThreadActions
}) {
  const { page, mode, active } = props
  const narrow = useMatches('(max-width: 62.5rem)')
  // the file's first, then the rest in the order of their text
  const all = [
    ...page.comments.filter((c) => c.place.kind === 'file'),
    ...page.comments
      .filter((c) => c.place.kind === 'text' || c.place.kind === 'section' || c.place.kind === 'block')
      .sort((a, b) => offsetOf(a) - offsetOf(b)),
  ]
  const shown = mode === 'all' ? all : mode === 'selected' && active !== null ? together(all, active) : []
  const card = (c: PageComment, size: CardSize, context = false) => (
    <ThreadCard
      comment={c}
      actions={props.actions}
      active={c.info.id === active}
      onSelect={() => props.onActive(c.info.id)}
      showTarget={context || c.place.kind === 'file'}
      context={context}
      size={size}
    />
  )
  if (mode === 'off') {
    return <aside className="focus-notes" aria-label={`Comments on ${page.path}`} inert />
  }
  if (narrow) {
    return (
      <aside className="focus-notes is-list" aria-label={`Comments on ${page.path}`}>
        {shown.map((c) => (
          <div key={c.info.id}>{card(c, 'full', true)}</div>
        ))}
      </aside>
    )
  }
  return (
    <aside className="focus-notes" aria-label={`Comments on ${page.path}`}>
      <CommentGutter
        documentRef={props.text}
        follows={false}
        active={active}
        notes={shown.map((c) => ({ id: c.info.id, content: (size: CardSize) => card(c, size) }))}
        {...(mode === 'selected' ? { empty: 'Select a highlight to see its comment.' } : {})}
      />
    </aside>
  )
}

/** The comment selected, and any others on the same section or block, which open with it. */
function together(all: PageComment[], id: string): PageComment[] {
  const chosen = all.find((c) => c.info.id === id)
  if (!chosen) {
    return []
  }
  const place = chosen.place
  return all.filter((c) =>
    c === chosen
      ? true
      : place.kind === 'section'
        ? c.place.kind === 'section' && c.place.heading === place.heading
        : place.kind === 'block'
          ? c.place.kind === 'block' && c.place.start === place.start
          : false,
  )
}

/** Whether a media query matches, now and as it changes. */
function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const changed = () => setMatches(list.matches)
    changed()
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [query])
  return matches
}

function offsetOf(comment: PageComment): number {
  return comment.place.kind === 'text' || comment.place.kind === 'block'
    ? comment.place.start
    : comment.place.kind === 'section'
      ? comment.place.heading
      : -1
}

function setIn<T>(map: Map<string, T>, key: string, value: T | null) {
  if (value) {
    map.set(key, value)
  } else {
    map.delete(key)
  }
}

function remToPx(rem: number) {
  return rem * parseFloat(getComputedStyle(document.documentElement).fontSize)
}
