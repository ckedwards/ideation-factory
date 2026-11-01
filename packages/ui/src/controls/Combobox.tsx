import { useId, useState, type KeyboardEvent } from 'react'
import { Avatar } from '../people/Avatar.tsx'
import type { Person } from '../people/person.ts'
import { Highlight } from '../labels/Highlight.tsx'
import './Combobox.css'

export interface ComboboxOption {
  id: string
  label: string
  // a second line: "@riley · Mobile", "2,148 members"
  sub?: string
  // shown with their avatar
  person?: Person
}

export interface ComboboxProps {
  // what's being picked, for screen readers ("Author")
  label: string
  // the current choice, or null for none
  value: ComboboxOption | null
  onChange: (option: ComboboxOption | null) => void
  // the text typed so far, and the results for it: the page searches (on the
  // server, as there can be thousands) and passes the first few back
  query: string
  onQueryChange: (query: string) => void
  options: ComboboxOption[]
  // shown before anything's typed ("You")
  pinned?: ComboboxOption[]
  placeholder?: string
  // after "No matches for …": what else to try
  emptyHint?: string
  loading?: boolean
}

// Pick one thing out of thousands: type to search, choose from a short list.
export function Combobox({
  label,
  value,
  onChange,
  query,
  onQueryChange,
  options,
  pinned = [],
  placeholder,
  emptyHint,
  loading = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const typed = query.trim() !== ''
  const results = typed ? options : pinned
  const choose = (option: ComboboxOption | null) => {
    onChange(option)
    onQueryChange('')
    setOpen(false)
  }
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter' && open && results[active]) {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  if (value) {
    return (
      <span className="combo-value">
        {value.person && <Avatar person={value.person} size="sm" decorative />}
        <span className="combo-value-label">
          <span className="visually-hidden">{label}: </span>
          {value.label}
        </span>
        <button type="button" className="combo-clear" aria-label={`Clear ${label}`} onClick={() => choose(null)}>
          ✕
        </button>
      </span>
    )
  }

  const showList = open && results.length > 0
  const showEmpty = open && typed && !loading && results.length === 0
  const activeOption = showList ? results[active] : undefined
  return (
    <div className="combo">
      <input
        className="combo-input"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onQueryChange(event.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={keys}
      />
      <ul className="combo-list" id={listId} role="listbox" aria-label={label} hidden={!showList}>
        {results.map((option, index) => (
          <li
            key={option.id}
            id={`${listId}-${option.id}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? 'is-active' : undefined}
            onMouseEnter={() => setActive(index)}
            // mousedown, not click: the input keeps focus, so its blur doesn't close the list first
            onMouseDown={(event) => {
              event.preventDefault()
              choose(option)
            }}
          >
            {option.person && <Avatar person={option.person} size="sm" decorative />}
            <span className="combo-option">
              <Highlight text={option.label} query={query} />
              {option.sub && (
                <span className="combo-sub">
                  <Highlight text={option.sub} query={query} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {(showEmpty || (open && typed && loading)) && (
        <div className="combo-list combo-note" role="status">
          {loading ? 'Searching…' : `No matches for “${query.trim()}”.${emptyHint ? ` ${emptyHint}` : ''}`}
        </div>
      )}
    </div>
  )
}
