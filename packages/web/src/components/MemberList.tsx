// A team's or a group's members, with their roles: admins and maintainers
// marked, members plain.
import { Button, Empty, Link, type Person, Tag, UserName } from '@ideaf/ui'
import './ContainerList.css'

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
}

export function MemberList({ members, more }: MemberListProps) {
  if (members.length === 0) {
    return <Empty>No members yet.</Empty>
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
