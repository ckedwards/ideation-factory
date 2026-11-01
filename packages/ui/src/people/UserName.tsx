import { Tag } from '../labels/Tag.tsx'
import { Avatar } from './Avatar.tsx'
import type { Person } from './person.ts'
import './UserName.css'

export interface UserNameProps {
  person: Person
  // with their avatar first
  withAvatar?: boolean
}

// A person's name, marked if they're inactive.
export function UserName({ person, withAvatar = false }: UserNameProps) {
  return (
    <span className="user-name" title={person.handle ? `@${person.handle}` : undefined}>
      {withAvatar && <Avatar person={person} size="sm" decorative />}
      <span className="user-name-text">{person.name}</span>
      {person.inactive && (
        <Tag tone="dashed" title="Marked inactive by a site admin. Read only.">
          inactive
        </Tag>
      )}
    </span>
  )
}
