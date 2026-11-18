import type { ReactNode } from 'react'
import { Link } from '../link/Link.tsx'
import './SideNav.css'

export interface NavItem {
  href: string
  label: ReactNode
  // the page being shown
  current?: boolean
  // unread or open things, shown as a count
  count?: number
  // a short tag after the label ("All", "Active" for a watched team)
  note?: string
  // something only a site admin can reach
  admin?: boolean
}

export interface NavGroup {
  // a heading above the group ("Your teams"); none for the main links
  title?: string
  items: NavItem[]
  // shown when there are no items
  empty?: ReactNode
  // after the items: "See all"
  more?: ReactNode
}

export interface SideNavProps {
  groups: NavGroup[]
}

// The site's navigation and nothing else: the main links, your teams, the teams you watch. The site's
// name, your notifications and your account are in the app's bar above it.
export function SideNav({ groups }: SideNavProps) {
  return (
    <div className="side-nav">
      {groups.map((group, i) => (
        <nav key={group.title ?? i} className="side-nav-group" aria-label={group.title ?? 'Main'}>
          {group.title && (
            <div className="side-nav-title" aria-hidden>
              {group.title}
            </div>
          )}
          {group.items.length === 0 && group.empty && <div className="side-nav-empty">{group.empty}</div>}
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`side-nav-item${item.admin ? ' is-admin' : ''}`}
              aria-current={item.current ? 'page' : undefined}
            >
              {item.admin && <span aria-hidden>🛡 </span>}
              <span className="side-nav-label">{item.label}</span>
              {item.note && <span className="side-nav-note">{item.note}</span>}
              {item.count ? (
                <span className="side-nav-count">
                  {item.count > 99 ? '99+' : item.count}
                  <span className="visually-hidden"> unread</span>
                </span>
              ) : null}
            </Link>
          ))}
          {group.more}
        </nav>
      ))}
    </div>
  )
}
