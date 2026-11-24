// Who's in a live draft with you (docs/handoff-live-editing.md, step 4): their faces in the bar, in
// the order they arrived, each ringed in their color for the draft, the color of their caret. Five
// at most, then "+3", which opens the list of everyone. Choosing a face, or a row of the list, goes
// to where that person is. People arriving and leaving are announced to screen readers.
//
// Each entry is a browser window: the same person in two windows is two entries, and their other
// window says so (`note`).
import { Popover } from '@base-ui/react/popover'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from './Avatar.tsx'
import type { Person } from './person.ts'
import './PresenceStack.css'

/** One window in the draft: whose, its color (1 to 8), and a word about it ("another window"). */
export interface Present {
  key: string
  person: Person
  color: number
  note?: string
}

export interface PresenceStackProps {
  /** Everyone else in the draft, in the order they arrived. */
  present: Present[]
  /** Go to where that window is. */
  onGo: (key: string) => void
  /** How many faces before "+N". */
  max?: number
}

const labelOf = (p: Present) => (p.note ? `${p.person.name} (${p.note})` : p.person.name)

export function PresenceStack({ present, onGo, max = 5 }: PresenceStackProps) {
  const [open, setOpen] = useState(false)
  const announced = useAnnouncements(present)
  const shown = present.length > max ? present.slice(0, max) : present
  const more = present.length - shown.length
  const face = (p: Present) => (
    <button
      key={p.key}
      type="button"
      className="presence-face"
      data-color={p.color}
      title={labelOf(p)}
      onClick={() => onGo(p.key)}
    >
      <Avatar person={p.person} size="sm" decorative />
      <span className="visually-hidden">{labelOf(p)}: go to where they are</span>
    </button>
  )
  return (
    <span className="presence-stack" role="group" aria-label="In the draft with you">
      {shown.map(face)}
      {more > 0 && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger className="presence-more">
            +{more}
            <span className="visually-hidden"> more: everyone in the draft</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner className="presence-list-positioner" side="bottom" align="end" sideOffset={6}>
              <Popover.Popup className="presence-list" aria-label="Everyone in the draft">
                <p className="presence-list-title">
                  {present.length} {present.length === 1 ? 'other' : 'others'} in the draft, in the order they arrived
                </p>
                <ul>
                  {present.map((p, i) => (
                    <li key={p.key} className={i === max ? 'is-after-shown' : undefined}>
                      <button
                        type="button"
                        className="presence-row"
                        data-color={p.color}
                        onClick={() => {
                          setOpen(false)
                          onGo(p.key)
                        }}
                      >
                        <span className="presence-row-face">
                          <Avatar person={p.person} size="sm" decorative />
                        </span>
                        <span className="presence-row-name">{p.person.name}</span>
                        {p.note && <span className="presence-row-note">{p.note}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
      <span className="visually-hidden" role="status" aria-live="polite">
        {announced}
      </span>
    </span>
  )
}

/** "Priya Raman joined the draft", "… left the draft": what changed since the last time, as it changes. */
function useAnnouncements(present: Present[]): string {
  const before = useRef<Map<string, string> | null>(null)
  const [said, setSaid] = useState('')
  const key = present.map((p) => `${p.key}:${labelOf(p)}`).join('\n')
  useEffect(() => {
    const now = new Map(present.map((p) => [p.key, labelOf(p)]))
    const was = before.current
    before.current = now
    // those here when the page opened aren't news
    if (!was) {
      return
    }
    const joined = [...now].filter(([k]) => !was.has(k)).map(([, name]) => `${name} joined the draft.`)
    const left = [...was].filter(([k]) => !now.has(k)).map(([, name]) => `${name} left the draft.`)
    if (joined.length + left.length > 0) {
      setSaid([...joined, ...left].join(' '))
    }
    // by who's in it, not which array it came in
  }, [key])
  return said
}
