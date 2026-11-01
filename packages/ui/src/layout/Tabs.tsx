import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import './Tabs.css'

export interface Tab<T extends string> {
  id: T
  label: string
  // shown after the label: open comments, unread
  count?: number
}

export interface TabsProps<T extends string> {
  // what the tabs switch between, for screen readers ("Panel")
  label: string
  tabs: Tab<T>[]
  value: T
  onChange: (id: T) => void
  // the chosen tab's content
  children: ReactNode
}

// Tabs over one panel. Tab reaches the chosen tab, the arrow keys (and Home and
// End) move between tabs, and the panel follows.
export function Tabs<T extends string>({ label, tabs, value, onChange, children }: TabsProps<T>) {
  const base = useId()
  const list = useRef<HTMLDivElement>(null)
  const keys = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key]
    if (next === undefined) {
      return
    }
    event.preventDefault()
    const wrapped = next > last ? 0 : next < 0 ? last : next
    const tab = tabs[wrapped]
    if (tab) {
      onChange(tab.id)
      list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[wrapped]?.focus()
    }
  }
  return (
    <div className="tabs">
      <div className="tabs-list" role="tablist" aria-label={label} ref={list}>
        {tabs.map((tab, index) => {
          const selected = tab.id === value
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => keys(event, index)}
            >
              {tab.label}
              {tab.count ? <span className="tabs-count">{tab.count}</span> : null}
            </button>
          )
        })}
      </div>
      <div className="tabs-panel" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`}>
        {children}
      </div>
    </div>
  )
}
