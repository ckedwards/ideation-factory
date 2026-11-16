// A team's or a group's members, with their roles: admins and maintainers
// marked, members plain. Compact, it's a column of names (admins and
// maintainers first, as the members are sorted by role), the first twelve
// until Show all.
import { useState } from 'react'
import { Button, Empty, Link, type Person, Tag, UserName } from '@ideaf/ui'
import './ContainerList.css'
import './MemberList.css'

export interface MemberInfo {
  person: Person
  role: 'admin' | 'maintainer' | 'member'
  /** When they joined (ms). */
  joined?: number
  /** Their own membership's role, or null when they're in only through groups. */
  direct?: 'admin' | 'maintainer' | 'member' | null
  /** The groups they're in it through (a team's), with the role each gives them. */
  through?: Array<{ group: { id: string; handle: string; name: string }; role: 'admin' | 'maintainer' | 'member' }>
}

export interface MemberListProps {
  members: MemberInfo[]
  more?: { loading: boolean; onMore: () => void } | null
  /** A column of names, the first twelve until Show all (of `total`). */
  compact?: { total: number }
}

const FIRST = 12

export function MemberList({ members, more, compact }: MemberListProps) {
  const [all, setAll] = useState(false)
  if (members.length === 0) {
    return <Empty>No members yet.</Empty>
  }
  if (compact) {
    const shown = all ? members : members.slice(0, FIRST)
    return (
      <div className="member-column">
        <ul aria-label="Members">
          {shown.map(({ person, role }) => (
            <li key={person.id}>
              <Link href={`/@${person.handle}`}>
                <UserName person={person} withAvatar />
              </Link>
              {role !== 'member' && <Tag tone={role === 'admin' ? 'admin' : 'neutral'}>{role}</Tag>}
            </li>
          ))}
        </ul>
        {!all && compact.total > shown.length ? (
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Show all {compact.total}
          </Button>
        ) : (
          all &&
          more && (
            <Button size="sm" variant="ghost" onClick={more.onMore} disabled={more.loading}>
              {more.loading ? 'Loading…' : 'Show more'}
            </Button>
          )
        )}
      </div>
    )
  }
  return (
    <div>
      <ul className="container-list" aria-label="Members">
        {members.map(({ person, role }) => (
          <li key={person.id} className="container-row">
            <div className="container-row-head">
              <Link href={`/@${person.handle}`}>
                <UserName person={person} withAvatar />
              </Link>
              {role !== 'member' && <Tag tone={role === 'admin' ? 'admin' : 'neutral'}>{role}</Tag>}
            </div>
          </li>
        ))}
      </ul>
      {more && (
        <Button variant="ghost" onClick={more.onMore} disabled={more.loading}>
          {more.loading ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </div>
  )
}
