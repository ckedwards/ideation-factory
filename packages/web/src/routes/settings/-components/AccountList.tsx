// A list on your settings page (where you're signed in, your passkeys, your
// tokens, apps that act for you): each with what it is, a line about it, and
// usually a way to end it.
import type { ReactNode } from 'react'
import { Button, Empty, Tag } from '@ideaf/ui'
import './AccountList.css'

export interface AccountItem {
  id: string
  title: ReactNode
  sub?: ReactNode
  /** This one is the one you're using. */
  current?: boolean
  action?: { label: string; onClick: () => void } | undefined
}

export interface AccountListProps {
  label: string
  items: AccountItem[]
  empty: ReactNode
}

export function AccountList({ label, items, empty }: AccountListProps) {
  if (items.length === 0) {
    return <Empty>{empty}</Empty>
  }
  return (
    <ul className="account-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className="account-row">
          <span className="account-row-what">
            <span className="account-row-title">
              {item.title} {item.current && <Tag tone="ok">this one</Tag>}
            </span>
            {item.sub && <span className="account-row-sub">{item.sub}</span>}
          </span>
          {item.action && (
            <Button size="sm" variant="ghost" onClick={item.action.onClick}>
              {item.action.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
