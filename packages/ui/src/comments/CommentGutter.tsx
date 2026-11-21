import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CardSize } from './CommentCard.tsx'
import { fitNotes, type FixedHeights, layoutNotes, type NoteUnit, unitGap } from './gutter.ts'
import { markForms, markSelector } from './marks.ts'
import { createPortal } from 'react-dom'
import './CommentGutter.css'

export interface CommentGutterProps {
  // the element the document's comment marks are in (data-comment-id)
  documentRef: RefObject<HTMLElement | null>
  // the text comments, each shown level with its mark; one whose text isn't
  // in the document isn't shown (the page lists it with the outdated ones).
  // Content drawn at a size is fitted to the room its stretch of the page has
  notes: { id: string; content: ReactNode | ((size: CardSize) => ReactNode) }[]
  // open: drawn full, level with its text, over the rest
  active?: string | null
  // when there are none
  empty?: ReactNode
}

// The panel beside the document, with each text comment level with the text
// it's on. Notes start level with their text and push each other down rather
// than overlap; the gutter follows the document as it scrolls, and scrolling
// over it scrolls the document. Whatever is above the gutter in its column,
// a note whose text is in the window is never placed above the gutter's top,
// where it would be cut off: it waits at the top edge, and the ones after it
// go under it.
//
// Where a stretch of the page is crowded its notes are smaller (fitNotes): short, a line, or a pile
// of lines that fans out when pointed at. Sizes are fitted again only when the comments, the window's
// width or the fonts change: never as the page scrolls, or because a card was opened. The open card
// is drawn full, level with its text, over its neighbors, which stay where they are: it keeps its
// place among them at its size, and a line ties it to its text when it can't be level with it.
//
// Pointing at a card lights its text, and pointing at the text lights its card.
export function CommentGutter({ documentRef, notes, active = null, empty }: CommentGutterProps) {
  const gutter = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  // each unit's element (a note, or a pile), by its first note's ID; and the open card's, drawn over
  const elements = useRef(new Map<string, HTMLDivElement>())
  const overlay = useRef<HTMLDivElement>(null)
  const tie = useRef<HTMLDivElement>(null)
  const [anchors, setAnchors] = useState<Map<string, Anchor>>(new Map())
  const [heights, setHeights] = useState(0)
  // the comment pointed at, on its text or its card
  const [lit, setLit] = useState<string | null>(null)
  // the pile pointed at, fanned into lines
  const [fanned, setFanned] = useState<string | null>(null)
  // a line chosen from a fanned pile opens it: the pile folds again
  useEffect(() => {
    setFanned(null)
  }, [active])
  const ids = notes.map((note) => note.id).join('\n')
  const sized = notes.some((note) => typeof note.content === 'function')

  // the sizes, fitted again only when the comments, the window's width or the fonts change; null
  // while fitting, when every note is drawn full to be measured
  const width = useWindowWidth()
  const fonts = useFontsLoaded()
  const [units, setUnits] = useState<NoteUnit[] | null>(null)
  // each note's height drawn full, as last fitted: the open card's place keeps it
  const fullHeights = useRef(new Map<string, number>())
  const fitKey = `${ids}|${width}|${fonts}|${anchors.size}`
  useLayoutEffect(() => {
    setUnits(null)
  }, [fitKey])
  useLayoutEffect(() => {
    const root = documentRef.current
    if (units !== null || !root) {
      return
    }
    const placed = [...anchors].map(([id, anchor]) => ({
      id,
      anchor: anchor.top,
      full: elements.current.get(id)?.offsetHeight ?? 0,
    }))
    fullHeights.current = new Map(placed.map((note) => [note.id, note.full]))
    setUnits(
      sized
        ? fitNotes(placed, fixedHeights(), remToPx(0.75), 2 * proseLine(root))
        : placed.sort((a, b) => a.anchor - b.anchor).map((note) => ({ ids: [note.id], size: 'full' })),
    )
  }, [units, anchors, sized, documentRef])

  // pointing at a comment's text
  useEffect(() => {
    const root = documentRef.current
    if (!root) {
      return
    }
    const known = new Set(ids.split('\n'))
    const over = (event: PointerEvent) => {
      const mark = (event.target as Element).closest?.('[data-comment-id], [data-comment-ids]')
      const id = mark?.getAttribute('data-comment-id') ?? mark?.getAttribute('data-comment-ids')?.split(' ')[0] ?? null
      setLit(id !== null && known.has(id) ? id : null)
    }
    const out = (event: PointerEvent) => {
      if (!root.contains(event.relatedTarget as Node | null)) {
        setLit(null)
      }
    }
    root.addEventListener('pointerover', over)
    root.addEventListener('pointerout', out)
    return () => {
      root.removeEventListener('pointerover', over)
      root.removeEventListener('pointerout', out)
    }
  }, [documentRef, ids])

  // where each comment's text is, from the top of the document
  useLayoutEffect(() => {
    const root = documentRef.current
    if (!root) {
      return
    }
    const measure = () => {
      const top = root.getBoundingClientRect().top
      const next = new Map<string, Anchor>()
      for (const id of ids.split('\n').filter(Boolean)) {
        const marks = [...root.querySelectorAll(markSelector(id))].map((mark) => mark.getBoundingClientRect())
        if (marks.length > 0) {
          next.set(id, {
            top: Math.min(...marks.map((box) => box.top)) - top,
            end: Math.max(...marks.map((box) => box.bottom)) - top,
          })
        }
      }
      setAnchors((was) => (same(was, next) ? was : next))
    }
    measure()
    // text reflows when the window or the text size changes, and when diagrams land
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [documentRef, ids])

  // what's drawn: while fitting, every note full; then each unit at its size, the open one keeping its
  // place at its size, drawn again over the rest
  const drawn: NoteUnit[] = units ?? [...anchors.keys()].map((id): NoteUnit => ({ ids: [id], size: 'full' }))
  const over = units !== null && active !== null && anchors.has(active) ? active : null
  const drawnKey = drawn.map((unit) => `${unit.size}:${unit.ids.join(',')}`).join(' ')

  // a note grows when its replies open
  useEffect(() => {
    const observer = new ResizeObserver(() => setHeights((n) => n + 1))
    for (const element of elements.current.values()) {
      observer.observe(element)
    }
    if (overlay.current) {
      observer.observe(overlay.current)
    }
    return () => observer.disconnect()
  }, [drawnKey, over])

  // place the notes, and follow the document: they move as it scrolls, and the gutter fills the rest
  // of the window. Written to the notes directly, as the document scrolls, rather than drawn again
  const latest = useRef({ anchors, drawn, over })
  // the fit last placed
  const placedFit = useRef<NoteUnit[] | null | undefined>(undefined)
  latest.current = { anchors, drawn, over }
  useLayoutEffect(() => {
    const root = documentRef.current
    const box = gutter.current
    const content = inner.current
    if (!root || !box || !content) {
      return
    }
    const place = () => {
      const page = root.getBoundingClientRect()
      const shown = box.getBoundingClientRect()
      content.style.transform = `translateY(${page.top - shown.top}px)`
      box.style.height = `${Math.max(0, window.innerHeight - Math.max(0, shown.top))}px`
      // the top of the window the document is read in, and of the gutter where it can be seen
      const windowTop = Math.max(0, topOf(scrollerOf(root)))
      const gutterTop = Math.max(shown.top, windowTop, topOf(scrollerOf(box)))
      const floor = { top: gutterTop - page.top, window: windowTop - page.top }
      const { anchors, drawn, over } = latest.current
      const fixed = fixedHeights()
      const tops = layoutNotes(
        drawn.map((unit) => {
          const anchor = anchors.get(unit.ids[0]!)!
          return {
            id: unit.ids[0]!,
            anchor: anchor.top,
            end: anchor.end,
            height: elements.current.get(unit.ids[0]!)?.offsetHeight ?? 0,
            gap: unitGap(unit, fixed, remToPx(0.75)),
          }
        }),
        remToPx(0.75),
        floor,
      )
      for (const [id, element] of elements.current) {
        const top = tops.get(id)
        if (top !== undefined) {
          element.style.top = `${top}px`
          element.style.visibility = ''
        }
      }
      // the open card, over the rest: level with its text, or as near as the gutter's top allows,
      // and tied to its text by a line when it isn't level with it
      const anchor = over === null ? undefined : anchors.get(over)
      if (anchor && overlay.current) {
        const top = anchor.end > floor.window ? Math.max(anchor.top, floor.top) : anchor.top
        overlay.current.style.top = `${top}px`
        overlay.current.style.visibility = ''
        if (tie.current) {
          tie.current.style.top = `${anchor.top}px`
          tie.current.style.height = `${Math.max(0, top - anchor.top)}px`
          tie.current.hidden = top - anchor.top < 2
        }
      }
    }
    // a new fit (and the first) is placed at once: its notes were drawn full to be measured, and
    // would slide from there
    const fitted = units !== placedFit.current
    placedFit.current = units
    let still: ReturnType<typeof setTimeout> | undefined
    const instant = () => {
      box.classList.add('is-instant')
      clearTimeout(still)
      still = setTimeout(() => box.classList.remove('is-instant'), 150)
    }
    if (fitted) {
      instant()
    }
    place()
    // scrolling moves the notes waiting at the top edge with it, at once rather than sliding
    const scrolled = () => {
      instant()
      place()
    }
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', place)
    return () => {
      clearTimeout(still)
      window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', place)
    }
  }, [documentRef, anchors, heights, drawnKey, over, units])

  const byId = new Map(notes.map((note) => [note.id, note]))
  const draw = (id: string, size: CardSize) => {
    const content = byId.get(id)?.content
    return typeof content === 'function' ? content(size) : content
  }
  // hidden until it's first placed, so it doesn't flash at the top (React attaches the same element
  // again on each drawing, already placed)
  const hideUnplaced = (element: HTMLDivElement) => {
    if (element.style.top === '') {
      element.style.visibility = 'hidden'
    }
  }
  return (
    <div
      ref={gutter}
      className="comment-gutter"
      onWheel={(event) => scrollerOf(documentRef.current)?.scrollBy({ top: event.deltaY })}
    >
      <div ref={inner} className="comment-gutter-inner">
        {drawn.map((unit) => {
          const key = unit.ids[0]!
          const pile = unit.size === 'pile'
          return (
            <div
              key={pile ? `pile:${unit.ids.join(',')}` : key}
              ref={(element) => {
                if (element) {
                  hideUnplaced(element)
                  elements.current.set(key, element)
                } else {
                  elements.current.delete(key)
                }
              }}
              className={`comment-gutter-note${pile ? ' is-pile' : ''}${pile && fanned === key ? ' is-fanned' : ''}`}
              data-note-id={pile || over === key ? undefined : key}
              data-place-of={over === key ? key : undefined}
              data-pile={pile ? unit.ids.join(' ') : undefined}
              data-size={unit.size}
              data-under={pile ? Math.min(3, unit.ids.length - 1) : undefined}
              style={pile ? ({ '--pile-under': Math.min(3, unit.ids.length - 1) } as CSSProperties) : undefined}
              onPointerEnter={() => (pile ? setFanned(key) : setLit(key))}
              onPointerLeave={() =>
                pile ? setFanned((was) => (was === key ? null : was)) : setLit((was) => (was === key ? null : was))
              }
            >
              {pile ? (
                <>
                  <div className="comment-pile-top">
                    {draw(key, 'line')}
                    <span className="comment-pile-count" aria-label={`${unit.ids.length} comments`}>
                      {unit.ids.length}
                    </span>
                  </div>
                  {/* pointed at, the lines it stands for, over what's under it */}
                  {fanned === key && (
                    <div className="comment-pile-fan">
                      {unit.ids.map((id) => (
                        <div key={id} data-note-id={id}>
                          {draw(id, 'line')}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : over === key ? (
                // its place, kept at its size while it's drawn open over the rest
                <div style={{ height: placeHeight(unit.size, fullHeights.current.get(key) ?? 0) }} />
              ) : (
                draw(key, unit.size === 'pile' ? 'line' : unit.size)
              )}
            </div>
          )
        })}
        {over !== null && (
          <>
            <div ref={tie} className="comment-gutter-tie" hidden />
            <div
              ref={(element) => {
                overlay.current = element
                if (element) {
                  hideUnplaced(element)
                }
              }}
              className="comment-gutter-note is-open"
              data-note-id={over}
              onPointerEnter={() => setLit(over)}
              onPointerLeave={() => setLit((was) => (was === over ? null : was))}
            >
              {draw(over, 'full')}
            </div>
          </>
        )}
      </div>
      {drawn.length === 0 && empty && <div className="comment-gutter-empty">{empty}</div>}
      {lit !== null && anchors.has(lit) && <style>{litStyle(lit)}</style>}
      <SectionBox documentRef={documentRef} id={lit ?? active} open={(lit ?? active) === active} />
    </div>
  )
}

/**
 * A section comment pointed at, or open: a rectangle around its whole section, from its heading to
 * the next heading at its level or above (filled while it's open). What tells a section comment from
 * one on its heading's words. Drawn over the document, following it as it scrolls.
 */
function SectionBox({
  documentRef,
  id,
  open,
}: {
  documentRef: RefObject<HTMLElement | null>
  id: string | null
  open: boolean
}) {
  const [box, setBox] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const root = documentRef.current
    if (!root || id === null) {
      setBox(null)
      return
    }
    const measure = () => setBox(sectionBox(root, id))
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [documentRef, id])
  if (!box) {
    return null
  }
  return createPortal(
    <div
      className={`comment-section-box${open ? ' is-open' : ''}`}
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      aria-hidden
    />,
    document.body,
  )
}

/** Where a section comment's section is on screen, or null if the comment isn't on a section. */
function sectionBox(root: HTMLElement, id: string): DOMRect | null {
  const heading = [...root.querySelectorAll(markSelector(id))].find((mark) =>
    mark.classList.contains('md-section-mark'),
  )
  if (!heading?.parentElement) {
    return null
  }
  const level = Number(heading.tagName.slice(1))
  let last: Element = heading
  for (let at = heading.nextElementSibling; at; at = at.nextElementSibling) {
    if (/^H[1-6]$/.test(at.tagName) && Number(at.tagName.slice(1)) <= level) {
      break
    }
    last = at
  }
  const top = heading.getBoundingClientRect()
  const bottom = last.getBoundingClientRect()
  const column = heading.parentElement.getBoundingClientRect()
  const pad = remToPx(0.5)
  return new DOMRect(column.left - pad, top.top - pad, column.width + 2 * pad, bottom.bottom - top.top + 2 * pad)
}

/** A note's place while it's drawn open over the rest: as tall as it is at its size. */
function placeHeight(size: NoteUnit['size'], full: number): string {
  return size === 'short' ? 'var(--comment-short-height)' : size === 'line' ? 'var(--comment-line-height)' : `${full}px`
}

/** The heights of the card sizes that don't depend on what's in them, from CommentCard.css. */
function fixedHeights(): FixedHeights {
  const style = getComputedStyle(document.documentElement)
  const length = (name: string, fallback: number) => {
    const value = style.getPropertyValue(name).trim()
    return value.endsWith('rem') ? remToPx(parseFloat(value)) : parseFloat(value) || fallback
  }
  return {
    short: length('--comment-short-height', 88),
    line: length('--comment-line-height', 32),
    pileStep: length('--comment-pile-step', 6),
    lineGap: length('--comment-line-gap', 4),
  }
}

/** A line of the document's prose: how far below its text a note can sit and still read as beside it. */
function proseLine(root: HTMLElement): number {
  const line = parseFloat(getComputedStyle(root.querySelector('p') ?? root).lineHeight)
  return Number.isFinite(line) ? line : 1.6 * remToPx(1)
}

/** The window's width, as it changes. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const resized = () => setWidth(window.innerWidth)
    window.addEventListener('resize', resized)
    return () => window.removeEventListener('resize', resized)
  }, [])
  return width
}

/** Whether the page's fonts have loaded: heights measured in a fallback font are wrong by a line or two. */
function useFontsLoaded(): boolean {
  const [loaded, setLoaded] = useState(() => document.fonts.status === 'loaded')
  useEffect(() => {
    let gone = false
    void document.fonts.ready.then(() => !gone && setLoaded(true))
    return () => {
      gone = true
    }
  }, [])
  return loaded
}

/**
 * The comment pointed at, lit on its text and its card: a rule for its ID, so the marks (drawn by
 * the document, or by the editor) and the card keep their own classes.
 */
function litStyle(id: string): string {
  const forms = markForms(id)
  const rule = (selectors: string[], declarations: string) => `${selectors.join(', ')} { ${declarations} }`
  return [
    rule(
      forms.map((form) => `.prose ${form}.md-mark:not(.is-resolved)`),
      'background: var(--mark-active);',
    ),
    rule(
      forms.map((form) => `.prose ${form}.md-section-mark::after`),
      'background: var(--mark-active);',
    ),
    // a block's marks grow into its rectangle
    rule(
      forms.map((form) => `.prose ${form}.md-block-mark`),
      '--edge: 100%;',
    ),
    `.comment-gutter-note[data-note-id="${CSS.escape(id)}"] .comment-card { border-color: var(--mark-line); }`,
  ].join('\n')
}

/** Where a comment's text is, from the top of the document: its first line's top, its last line's foot. */
interface Anchor {
  top: number
  end: number
}

function same(a: Map<string, Anchor>, b: Map<string, Anchor>): boolean {
  return (
    a.size === b.size &&
    [...a].every(([id, n]) => {
      const m = b.get(id)
      return m !== undefined && Math.abs(m.top - n.top) < 0.5 && Math.abs(m.end - n.end) < 0.5
    })
  )
}

function remToPx(rem: number): number {
  return rem * parseFloat(getComputedStyle(document.documentElement).fontSize || '16')
}

/** The top of an element in the window; the window's own top for the page itself. */
function topOf(element: HTMLElement | null): number {
  return element && element !== document.scrollingElement ? element.getBoundingClientRect().top : 0
}

// the nearest element that scrolls the document
function scrollerOf(element: HTMLElement | null): HTMLElement | null {
  for (let at = element; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) {
      return at
    }
  }
  return document.scrollingElement as HTMLElement | null
}
