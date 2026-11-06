import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { layoutNotes } from './gutter.ts'
import './CommentGutter.css'

export interface CommentGutterProps {
  // the element the document's comment marks are in (data-comment-id)
  documentRef: RefObject<HTMLElement | null>
  // the text comments, each shown level with its mark; one whose text isn't
  // in the document isn't shown (the page lists it with the outdated ones)
  notes: { id: string; content: ReactNode }[]
  // sits exactly level with its text
  active?: string | null
  // when there are none
  empty?: ReactNode
}

// The panel beside the document, with each text comment level with the text
// it's on. Notes start level with their text and push each other down rather
// than overlap; the gutter follows the document as it scrolls, and scrolling
// over it scrolls the document.
export function CommentGutter({ documentRef, notes, active = null, empty }: CommentGutterProps) {
  const gutter = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLDivElement>())
  const [anchors, setAnchors] = useState<Map<string, number>>(new Map())
  const [tops, setTops] = useState<Map<string, number>>(new Map())
  const [heights, setHeights] = useState(0)
  const ids = notes.map((note) => note.id).join('\n')

  // where each comment's text is, from the top of the document
  useLayoutEffect(() => {
    const root = documentRef.current
    if (!root) {
      return
    }
    const measure = () => {
      const top = root.getBoundingClientRect().top
      const next = new Map<string, number>()
      for (const id of ids.split('\n').filter(Boolean)) {
        const mark = root.querySelector(`[data-comment-id="${CSS.escape(id)}"]`)
        if (mark) {
          next.set(id, mark.getBoundingClientRect().top - top)
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

  // a note grows when its replies open
  useEffect(() => {
    const observer = new ResizeObserver(() => setHeights((n) => n + 1))
    for (const element of elements.current.values()) {
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [anchors])

  useLayoutEffect(() => {
    const placed = [...anchors].map(([id, anchor]) => ({
      id,
      anchor,
      height: elements.current.get(id)?.offsetHeight ?? 0,
    }))
    const next = layoutNotes(placed, active, remToPx(0.75))
    setTops((was) => (same(was, next) ? was : next))
  }, [anchors, active, heights])

  // follow the document: the notes move as it scrolls, and the gutter fills
  // the rest of the window
  useLayoutEffect(() => {
    const root = documentRef.current
    const box = gutter.current
    const content = inner.current
    if (!root || !box || !content) {
      return
    }
    const follow = () => {
      const offset = root.getBoundingClientRect().top - box.getBoundingClientRect().top
      content.style.transform = `translateY(${offset}px)`
      box.style.height = `${Math.max(0, window.innerHeight - Math.max(0, box.getBoundingClientRect().top))}px`
    }
    follow()
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  })

  const shown = notes.filter((note) => anchors.has(note.id)).sort((a, b) => anchors.get(a.id)! - anchors.get(b.id)!)
  return (
    <div
      ref={gutter}
      className="comment-gutter"
      onWheel={(event) => scrollerOf(documentRef.current)?.scrollBy({ top: event.deltaY })}
    >
      <div ref={inner} className="comment-gutter-inner">
        {shown.map((note) => (
          <div
            key={note.id}
            ref={(element) => {
              if (element) {
                elements.current.set(note.id, element)
              } else {
                elements.current.delete(note.id)
              }
            }}
            className="comment-gutter-note"
            data-note-id={note.id}
            // hidden until it's been placed, so it doesn't flash at the top
            style={tops.has(note.id) ? { top: tops.get(note.id) } : { visibility: 'hidden' }}
          >
            {note.content}
          </div>
        ))}
      </div>
      {shown.length === 0 && empty && <div className="comment-gutter-empty">{empty}</div>}
    </div>
  )
}

function same(a: Map<string, number>, b: Map<string, number>): boolean {
  return a.size === b.size && [...a].every(([id, n]) => Math.abs((b.get(id) ?? NaN) - n) < 0.5)
}

function remToPx(rem: number): number {
  return rem * parseFloat(getComputedStyle(document.documentElement).fontSize || '16')
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
