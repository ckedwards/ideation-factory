import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

// How it behaves:
// - opens after a delay on hover; once one has been open, the next opens at
//   once (moving down a list), until the pointer rests off them for a moment
// - opens straight away on keyboard focus
// - closes when the pointer leaves, and on click, scroll or Esc
// - a card above the anchor with an arrow (below if there's no room), in a
//   portal so rows that clip their overflow don't cut it off; it never takes
//   the pointer, so it doesn't get in the way
const OPEN_DELAY = 600
const WARM_FOR = 400
let warmUntil = 0

export interface TooltipProps {
  // what it explains; only rendered while open
  content: ReactNode | (() => ReactNode)
  children: ReactNode
  className?: string
  // make the anchor itself focusable, when what it wraps isn't (an icon, a label)
  focusable?: boolean
}

interface Position {
  top: number
  left: number
  arrow: number
  below: boolean
}

export function Tooltip({ content, children, className, focusable = false }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const id = useId()

  const show = (delay: number) => {
    window.clearTimeout(timer.current)
    if (delay <= 0 || Date.now() < warmUntil) {
      setOpen(true)
    } else {
      timer.current = window.setTimeout(() => setOpen(true), delay)
    }
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen((was) => {
      if (was) {
        warmUntil = Date.now() + WARM_FOR
      }
      return false
    })
  }

  useLayoutEffect(() => {
    if (!open || !anchor.current || !box.current) {
      setPosition(null)
      return
    }
    const a = anchor.current.getBoundingClientRect()
    const b = box.current.getBoundingClientRect()
    const gap = 8
    const below = a.top - gap - b.height < gap
    const top = below ? a.bottom + gap : a.top - gap - b.height
    const left = Math.max(gap, Math.min(a.left + a.width / 2 - b.width / 2, window.innerWidth - b.width - gap))
    setPosition({ top, left, below, arrow: a.left + a.width / 2 - left })
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <>
      <span
        ref={anchor}
        className={['tooltip-anchor', className].filter(Boolean).join(' ')}
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => show(OPEN_DELAY)}
        onMouseLeave={hide}
        onMouseDown={hide}
        onFocus={(event) => {
          if ((event.target as HTMLElement).matches(':focus-visible')) {
            show(0)
          }
        }}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            hide()
          }
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={box}
            id={id}
            role="tooltip"
            className={`tooltip${position?.below ? ' is-below' : ''}`}
            style={
              position
                ? { top: position.top, left: position.left, ['--arrow' as string]: `${position.arrow}px` }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
          >
            {typeof content === 'function' ? content() : content}
          </div>,
          document.body,
        )}
    </>
  )
}
