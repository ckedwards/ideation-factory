// One filter in a bar of them, as GitHub's and GitLab's lists have: a button
// that says what it filters and, once set, to what ("Author: Maya Patel"),
// opening a small popover with the way to choose (a picker, and any shortcuts
// first) and Clear. A bar of these takes one row where a form of labelled
// boxes took several.
import { Popover } from '@base-ui/react/popover'
import { type ReactNode, useState } from 'react'
import { Button } from '../controls/Button.tsx'
import { Icon } from '../labels/Icon.tsx'
import './FilterMenu.css'

export interface FilterMenuProps {
  /** What it filters: "Author". */
  label: string
  /** What it's set to, as it reads; null when it isn't. */
  value: string | null
  /** The way to choose; `close` closes the menu once a choice is made. */
  children: (close: () => void) => ReactNode
  onClear: () => void
  /** What its Clear says, when "Clear author" isn't it: "Stop comparing". */
  clearLabel?: string
}

export function FilterMenu({ label, value, children, onClear, clearLabel }: FilterMenuProps) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`filter-menu-trigger${value ? ' is-set' : ''}`}
        aria-label={value ? `${label}: ${value}` : label}
      >
        <span>{value ? `${label}:` : label}</span>
        {value && <span className="filter-menu-value">{value}</span>}
        <span className="filter-menu-caret">
          <Icon name="menu" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="filter-menu-positioner" side="bottom" align="start" sideOffset={4}>
          <Popover.Popup className="filter-menu" aria-label={label}>
            {children(close)}
            {value && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onClear()
                  close()
                }}
              >
                {clearLabel ?? `Clear ${label.toLowerCase()}`}
              </Button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
