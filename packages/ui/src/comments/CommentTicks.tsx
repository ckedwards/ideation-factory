// Ticks down the document's right edge, one per comment, each where its text is in the whole file:
// where the comments are in a long file, at a glance, and a click to each. The strip is the height of
// the pane the document scrolls in, and a tick halfway down it is a comment halfway through the file
// (not through what scrolls, which may have room after the file).
import { type RefObject, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { markSelector } from './marks.ts'
import './CommentTicks.css'

export interface CommentTicksProps {
  // the element the document's comment marks are in
  documentRef: RefObject<HTMLElement | null>
  // the comments to tick, in the order of the text, each with what a tick says it is
  comments: { id: string; label: string }[]
  active?: string | null
  onSelect: (id: string) => void
}

interface Ticks {
  // the strip: the scrolling pane's right edge, inside its scrollbar
  frame: { top: number; left: number; height: number }
  ticks: { id: string; label: string; at: number }[]
}

export function CommentTicks({ documentRef, comments, active = null, onSelect }: CommentTicksProps) {
  const [shown, setShown] = useState<Ticks | null>(null)
  const key = comments.map((c) => `${c.id}:${c.label}`).join('\n')
  // after the page's refs are set: the ticks may be drawn inside the document they measure
  useEffect(() => {
    const root = documentRef.current
    const pane = root ? scrollerOf(root) : null
    if (!root || !pane) {
      return
    }
    const measure = () => {
      const box = pane.getBoundingClientRect()
      const file = root.getBoundingClientRect()
      const ticks = comments.flatMap((comment) => {
        const mark = root.querySelector(markSelector(comment.id))
        if (!mark) {
          return []
        }
        const at = (mark.getBoundingClientRect().top - file.top) / Math.max(1, file.height)
        return [{ ...comment, at: Math.min(1, Math.max(0, at)) }]
      })
      setShown({
        frame: { top: box.top, left: box.left + pane.clientWidth, height: pane.clientHeight },
        ticks,
      })
    }
    measure()
    // the file reflows when the window or its text changes; scrolling moves nothing here
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [documentRef, key])
  if (!shown || shown.ticks.length === 0) {
    return null
  }
  return createPortal(
    <nav
      className="comment-ticks"
      aria-label="Comments in this file"
      style={{ top: shown.frame.top, left: shown.frame.left, height: shown.frame.height }}
    >
      {shown.ticks.map((tick) => (
        <button
          key={tick.id}
          type="button"
          className={`comment-tick${tick.id === active ? ' is-active' : ''}`}
          style={{ top: `${tick.at * 100}%` }}
          aria-label={tick.label}
          title={tick.label}
          onClick={(event) => {
            // its own: a click on the document around it (where React passes it on to) puts cards down
            event.stopPropagation()
            onSelect(tick.id)
          }}
        />
      ))}
    </nav>,
    document.body,
  )
}

// the pane the document scrolls in, whether or not it's long enough to scroll yet
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at: HTMLElement | null = element; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return at
    }
  }
  return null
}
