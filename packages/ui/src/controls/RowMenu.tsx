import { Menu } from '@base-ui/react/menu'
import './RowMenu.css'

export interface RowMenuItem {
  label: string
  onSelect: () => void
  // destructive: in the danger colour
  danger?: boolean
  // the current choice: checked
  current?: boolean
  // why it can't be used now: greyed, with the reason under it
  unavailable?: string
  // a key that does it too, shown beside it ("F2")
  shortcut?: string
}

export interface RowMenuProps {
  // what the menu acts on, for screen readers ("Maya Chen")
  label: string
  // in groups, each with an optional heading ("Role")
  groups: Array<{ label?: string; items: RowMenuItem[] }>
  // -1 in a list that moves focus by arrow keys, where only the focused row's ⋯ is a Tab stop
  tabIndex?: number
  className?: string
}

// A row's actions, behind ⋯: read far more often than they're changed, so they stay out of the way,
// as GitHub's and GitLab's member lists keep theirs. Base UI's menu does the keyboard and focus work.
export function RowMenu({ label, groups, tabIndex, className }: RowMenuProps) {
  const shown = groups.filter((g) => g.items.length > 0)
  if (shown.length === 0) {
    return null
  }
  return (
    <Menu.Root>
      <Menu.Trigger
        className={className ? `row-menu-trigger ${className}` : 'row-menu-trigger'}
        {...(tabIndex !== undefined ? { tabIndex } : {})}
      >
        <span aria-hidden>⋯</span>
        <span className="visually-hidden">{label}: actions</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="row-menu-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="row-menu">
            {shown.map((group, i) => (
              <Menu.Group key={group.label ?? i}>
                {i > 0 && <Menu.Separator className="row-menu-separator" />}
                {group.label && <Menu.GroupLabel className="row-menu-label">{group.label}</Menu.GroupLabel>}
                {group.items.map((item) => (
                  <Menu.Item
                    key={item.label}
                    className={`row-menu-item${item.danger ? ' is-danger' : ''}`}
                    onClick={item.onSelect}
                    disabled={item.current || item.unavailable !== undefined}
                  >
                    <span className="row-menu-check" aria-hidden>
                      {item.current ? '✓' : ''}
                    </span>
                    <span className="row-menu-text">
                      {item.label}
                      {item.unavailable && <span className="row-menu-why">{item.unavailable}</span>}
                    </span>
                    {item.shortcut && (
                      <kbd className="row-menu-shortcut" aria-hidden>
                        {item.shortcut}
                      </kbd>
                    )}
                    {item.current && <span className="visually-hidden"> (now)</span>}
                  </Menu.Item>
                ))}
              </Menu.Group>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
