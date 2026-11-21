// The focus view: an idea's files with everything else out of the way. Each
// file is a page on a sheet of its own, one under the other in one scroll, with
// the pages' names down the left. Comments are hidden until asked for; then each
// page's open threads sit beside it, level with their text, and can be acted on
// as on the Files tab, their buttons opening only when the pointer rests on one
// or focus is in it. Getting in and out carries the text you were reading
// between the Files tab and its sheet, so it never jumps or shows twice.
//
// It's drawn over the whole window, above the app's bar and the idea's, with
// the page beneath inert. IdeaView says when it's opening, open, or leaving.
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { markdownTree } from '@ideaf/core'
import {
  Button,
  defaultResolveLink,
  headings,
  layoutNotes,
  MarkdownView,
  renderMermaid,
  SelectionMenu,
  type TextSelection,
} from '@ideaf/ui'
import { type PageComment, type ThreadActions, ThreadCard } from './ThreadCard.tsx'
import './FocusView.css'

/** still: open from the start (its address opened directly), nothing to carry from. */
export type FocusPhase = 'still' | 'entering' | 'open' | 'leaving'

/** One file, one page: its open comments, placed in it. */
export interface FocusPage {
  id: string
  path: string
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
}

const DURATION = 300
const COMMENTS = 240
const EASE = 'cubic-bezier(.4, 0, .2, 1)'
// how far the text can be carried; further, and its sheet fades in place
const CARRY = 600
// the page and heading being read are the last whose top is above this line
const SPY = 140
// the gap between threads
const GAP = 12

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
  const [comments, setComments] = useState(false)
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
    setComments(false)
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

  const exit = () => {
    const page = latest.current.pages.find((p) => p.id === current.page)
    props.onExit(page?.path ?? props.file)
  }
  const toggle = () => {
    cancel()
    setStill(false)
    setComments(!comments)
  }
  const go = (id: string) => {
    setPagesOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
  }

  const actions: ThreadActions = props.actions

  const classes = [
    'focus-view',
    open && 'is-open',
    comments && 'has-comments',
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
          <Button aria-pressed={comments} onClick={toggle}>
            Comments <span className="focus-count">{count}</span>
          </Button>
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
                  {page.path}
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
            carried={carried === page.id}
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
          const at = c.place.kind === 'text' ? c.place.start : c.place.kind === 'section' ? c.place.heading : -1
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
  index: number
  of: number
  page: FocusPage
  tree: ReturnType<typeof markdownTree>
  comments: boolean
  carried: boolean
  active: string | null
  onActive: (id: string) => void
  actions: ThreadActions
  rowRef: (element: HTMLElement | null) => void
  sheetRef: (element: HTMLElement | null) => void
  suggestionOf?: (selection: TextSelection) => string | null
  onComment?: (selection: TextSelection, body: string, pending: boolean) => void
  onSuggest?: (selection: TextSelection, replacement: string, body: string, pending: boolean) => void
}

/** A page: its sheet, and its threads beside it. */
function Row(props: RowProps) {
  const { page, index, comments, active } = props
  const sheet = useRef<HTMLElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const prefix = prefixOf(index)
  const inText = page.comments.filter((c) => c.place.kind === 'text' || c.place.kind === 'section')
  return (
    <div
      className={`focus-row${props.carried ? ' is-carried' : ''}`}
      id={rowId(index)}
      ref={props.rowRef}
      style={{ ['--row' as string]: index }}
    >
      <article
        className="focus-sheet"
        aria-labelledby={`${prefix}name`}
        ref={(element) => {
          sheet.current = element
          props.sheetRef(element)
        }}
      >
        <header className="focus-sheet-head">
          <span id={`${prefix}name`}>{page.path}</span>
          <span className="focus-sheet-n">
            {index + 1} of {props.of}
          </span>
        </header>
        <div ref={text}>
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
      </article>
      <Notes
        page={page}
        sheet={sheet}
        shown={comments}
        active={active}
        onActive={props.onActive}
        actions={props.actions}
      />
    </div>
  )
}

interface Note {
  id: string
  // where its text is, from the top of the sheet; the whole file's threads come first
  node: ReactNode
}

/**
 * A page's threads, beside its sheet: each level with its text, or under the one above it. Laid out
 * from each thread's height at rest, so a thread's buttons opening grow it over the next one and move
 * nothing; a reply box opening does move the ones below. A thread dealt with fades out to the right.
 */
function Notes(props: {
  page: FocusPage
  sheet: RefObject<HTMLElement | null>
  shown: boolean
  active: string | null
  onActive: (id: string) => void
  actions: ThreadActions
}) {
  const { page, shown, active } = props
  const column = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const [tops, setTops] = useState<Map<string, number>>(new Map())
  const [floor, setFloor] = useState(0)
  const onFile = page.comments.filter((c) => c.place.kind === 'file')
  // in the order of their text: where they're listed under the sheet, that's the order they're read in
  const inText = page.comments
    .filter((c) => c.place.kind === 'text' || c.place.kind === 'section')
    .sort((a, b) => offsetOf(a) - offsetOf(b))
  const card = (c: PageComment) => (
    <ThreadCard
      comment={c}
      actions={props.actions}
      active={c.info.id === active}
      onSelect={() => props.onActive(c.info.id)}
    />
  )
  const notes: Note[] = [
    ...(onFile.length > 0
      ? [
          {
            id: 'file',
            node: (
              <>
                <h3 className="focus-note-label">On the whole file</h3>
                {onFile.map((c) => (
                  <div key={c.info.id} className="focus-thread">
                    {card(c)}
                  </div>
                ))}
              </>
            ),
          },
        ]
      : []),
    ...inText.map((c) => ({
      id: c.info.id,
      node: (
        <div className="focus-thread">
          <p className="focus-note-where">
            {c.info.target.kind === 'text'
              ? `“${c.info.target.quote}”`
              : c.info.target.kind === 'section'
                ? `§ ${c.info.target.title}`
                : null}
          </p>
          {card(c)}
        </div>
      ),
    })),
  ]
  const ids = notes.map((n) => n.id).join('\n')

  // threads dealt with, kept a moment to fade out
  const last = useRef(new Map<string, ReactNode>())
  const [going, setGoing] = useState<Map<string, ReactNode>>(new Map())
  useLayoutEffect(() => {
    const now = new Set(notes.map((n) => n.id))
    const gone = [...last.current].filter(([id]) => !now.has(id) && !id.startsWith('pending-') && id !== 'file')
    last.current = new Map(notes.map((n) => [n.id, n.node]))
    if (gone.length === 0 || !shown) {
      return
    }
    setGoing((was) => new Map([...was, ...gone]))
    window.setTimeout(
      () =>
        setGoing((was) => {
          const next = new Map(was)
          for (const [id] of gone) {
            next.delete(id)
          }
          return next
        }),
      COMMENTS,
    )
  }, [ids])

  // where each thread goes: level with its text, or under the one above
  useLayoutEffect(() => {
    const sheet = props.sheet.current
    if (!sheet) {
      return
    }
    const hover = !window.matchMedia('(hover: none)').matches
    const layout = () => {
      const top = sheet.getBoundingClientRect().top
      const placed = notes.flatMap((note) => {
        const element = elements.current.get(note.id)
        if (!element) {
          return []
        }
        const mark = note.id === 'file' ? null : sheet.querySelector(`[data-comment-id="${CSS.escape(note.id)}"]`)
        if (note.id !== 'file' && !mark) {
          return []
        }
        return [
          {
            id: note.id,
            anchor: mark ? mark.getBoundingClientRect().top - top - GAP : -1,
            height: hover ? restHeight(element) : element.offsetHeight,
          },
        ]
      })
      const next = layoutNotes(placed, GAP)
      const bottom = Math.max(0, ...placed.map((p) => (next.get(p.id) ?? 0) + p.height))
      setTops((was) => (same(was, next) ? was : next))
      setFloor(bottom)
    }
    layout()
    const observer = new ResizeObserver(layout)
    observer.observe(sheet)
    for (const element of elements.current.values()) {
      observer.observe(element)
    }
    void document.fonts?.ready.then(layout)
    return () => observer.disconnect()
  }, [ids, page.source, props.sheet])

  let shownIndex = 0
  return (
    <aside
      className="focus-notes"
      aria-label={`Comments on ${page.path}`}
      ref={column}
      inert={!shown}
      style={{ ['--notes-h' as string]: `${floor}px` }}
    >
      {notes.map((note) => {
        const top = tops.get(note.id)
        return (
          <div
            key={note.id}
            className={`focus-note${top === undefined ? ' is-unplaced' : ''}`}
            ref={(element) => setIn(elements.current, note.id, element)}
            style={{ top: `${Math.max(0, top ?? 0)}px`, ['--i' as string]: Math.min(shownIndex++, 8) }}
          >
            {note.node}
          </div>
        )
      })}
      {[...going].map(([id, node]) => (
        <div key={`going-${id}`} className="focus-note is-going" style={{ top: `${tops.get(id) ?? 0}px` }} aria-hidden>
          {node}
        </div>
      ))}
    </aside>
  )
}

/** A thread's height with its buttons closed, however far open they are. */
function restHeight(element: HTMLElement): number {
  let height = element.offsetHeight
  for (const actions of element.querySelectorAll<HTMLElement>('.comment-actions, .suggestion-actions')) {
    // closed, their row in the card's grid is empty: what they add is their height less the negative margin
    // they close with, and never less than nothing
    height -= Math.max(
      0,
      actions.getBoundingClientRect().height + (parseFloat(getComputedStyle(actions).marginTop) || 0),
    )
  }
  return Math.round(height)
}

function offsetOf(comment: PageComment): number {
  return comment.place.kind === 'text'
    ? comment.place.start
    : comment.place.kind === 'section'
      ? comment.place.heading
      : -1
}

function same(a: Map<string, number>, b: Map<string, number>) {
  return a.size === b.size && [...a].every(([k, v]) => Math.abs((b.get(k) ?? NaN) - v) < 0.5)
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
