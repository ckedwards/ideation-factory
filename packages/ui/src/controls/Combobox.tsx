import { Combobox as Base } from '@base-ui/react/combobox'
import { useState } from 'react'
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
// Base UI's combobox does the keyboard, focus and screen-reader work; the list
// opens in a portal, placed under the input or above it when there's no room.
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
  const typed = query.trim() !== ''
  const results = typed ? options : pinned
  const choose = (option: ComboboxOption | null) => {
    onChange(option)
    onQueryChange('')
    setOpen(false)
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

  // open only with something to show: results, or why there are none
  const showing = open && (results.length > 0 || typed)
  return (
    <Base.Root<ComboboxOption>
      items={results}
      // the page searched already (on the server); show what it found
      filter={null}
      value={null}
      onValueChange={(option) => option && choose(option)}
      inputValue={query}
      onInputValueChange={(next) => onQueryChange(next)}
      open={showing}
      onOpenChange={setOpen}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.id === b.id}
      autoHighlight
    >
      <Base.Input className="combo-input" aria-label={label} placeholder={placeholder} />
      <Base.Portal>
        <Base.Positioner className="combo-positioner" side="bottom" align="start" sideOffset={4} collisionPadding={8}>
          <Base.Popup className="combo-popup">
            <Base.List className="combo-list" aria-label={label}>
              {(option: ComboboxOption) => (
                <Base.Item key={option.id} value={option} className="combo-item">
                  {option.person && <Avatar person={option.person} size="sm" decorative />}
                  <span className="combo-option">
                    <Highlight text={option.label} query={query} />
                    {option.sub && (
                      <span className="combo-sub">
                        <Highlight text={option.sub} query={query} />
                      </span>
                    )}
                  </span>
                </Base.Item>
              )}
            </Base.List>
            {typed && (loading || results.length === 0) && (
              <div className="combo-note" role="status">
                {loading ? 'Searching…' : `No matches for “${query.trim()}”.${emptyHint ? ` ${emptyHint}` : ''}`}
              </div>
            )}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}
