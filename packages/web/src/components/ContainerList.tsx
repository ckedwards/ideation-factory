// Teams or groups in a directory: each one's name linking to its page, its
// handle, how many members, and what it's for.
import type { ReactNode } from 'react'
import { Button, Empty, Link, Stack } from '@ideaf/ui'
import { plural } from '../plural.ts'
import './ContainerList.css'

export interface ContainerInfo {
  id: string
  handle: string
  name: string
  description: string
  members: number
  href: string
  /** A team that takes no new ideas. */
  archived?: boolean
}

export interface ContainerListProps {
  /** For screen readers: "Teams", "Groups". */
  label: string
  items: ContainerInfo[]
  empty: ReactNode
  more?: { loading: boolean; onMore: () => void } | null
}

export function ContainerList({ label, items, empty, more }: ContainerListProps) {
  if (items.length === 0) {
    return <Empty>{empty}</Empty>
  }
  return (
    <Stack gap={3}>
      <ul className="container-list" aria-label={label}>
        {items.map((item) => (
          <li key={item.id} className="container-row">
            <div className="container-row-head">
              <Link href={item.href}>{item.name}</Link>
              <span className="container-row-handle">{item.handle}</span>
              {item.archived && <span className="container-row-handle">· archived</span>}
              <span className="container-row-members">{plural(item.members, 'member')}</span>
            </div>
            {item.description && <p className="container-row-desc">{item.description}</p>}
          </li>
        ))}
      </ul>
      {more && (
        <div>
          <Button variant="ghost" onClick={more.onMore} disabled={more.loading}>
            {more.loading ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </Stack>
  )
}
