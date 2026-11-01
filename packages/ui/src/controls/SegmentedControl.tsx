import { useRef, type KeyboardEvent } from 'react'
import './SegmentedControl.css'

export interface Segment<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  // what the choice is, for screen readers ("Theme")
  label: string
  options: Segment<T>[]
  value: T
  onChange: (value: T) => void
}

// A few options side by side, one chosen: a radio group. Tab reaches the chosen
// option, and the arrow keys move between them.
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  const group = useRef<HTMLDivElement>(null)
  const move = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step) {
      return
    }
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    const option = options[next]
    if (option) {
      onChange(option.value)
      group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
    }
  }
  return (
    <div className="segmented" role="radiogroup" aria-label={label} ref={group}>
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
