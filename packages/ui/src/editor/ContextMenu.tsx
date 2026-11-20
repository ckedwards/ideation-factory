// The editor's own right-click menu, where it has one: in a table, the table's menu; on a link, editing,
// opening or removing it; on drawn HTML, the way to change it. Opened at the click (or, from the
// keyboard's menu key, at the caret). Everywhere else the browser's menu shows, spelling and all.
import { Menu } from '@base-ui/react/menu'
import type { TableOp } from './milkdown.ts'
import { usePopupTag } from './owner.ts'
import { TableItems } from './Toolbar.tsx'

export interface ContextMenuAt {
  x: number
  y: number
  table: boolean
  link: string | null
  html: boolean
}

export interface ContextMenuProps {
  at: ContextMenuAt | null
  onClose: () => void
  /** In a table, what its menu can't do where the click was. */
  tableOff: Set<TableOp>
  onTable: (op: TableOp) => void
  onEditLink: () => void
  onRemoveLink: () => void
  onSource: () => void
}

export function ContextMenu({ at, onClose, tableOff, onTable, onEditLink, onRemoveLink, onSource }: ContextMenuProps) {
  const tag = usePopupTag()
  // a point on the screen for the menu to open from
  const anchor = at
    ? { getBoundingClientRect: () => DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }) }
    : null
  return (
    <Menu.Root
      open={at !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <Menu.Portal>
        <Menu.Positioner
          className="md-editor-menu-positioner"
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
        >
          <Menu.Popup {...tag} className="md-editor-menu" aria-label="Editing">
            {at?.link && (
              <Menu.Group>
                <Menu.GroupLabel className="md-editor-menu-label">Link</Menu.GroupLabel>
                <Menu.Item className="md-editor-menu-item" onClick={onEditLink}>
                  Edit link…
                </Menu.Item>
                <Menu.Item
                  className="md-editor-menu-item"
                  onClick={() => window.open(at.link!, '_blank', 'noopener,noreferrer')}
                >
                  Open link
                </Menu.Item>
                <Menu.Item className="md-editor-menu-item" onClick={onRemoveLink}>
                  Remove link
                </Menu.Item>
              </Menu.Group>
            )}
            {at?.link && at.table && <Menu.Separator className="md-editor-menu-rule" />}
            {at?.table && <TableItems onTable={onTable} off={tableOff} />}
            {at?.html && (
              <Menu.Item className="md-editor-menu-item" onClick={onSource}>
                Edit in source view
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
