import { Avatar } from './Avatar.tsx'
import type { Person } from './person.ts'
import './AvatarStack.css'

export interface AvatarStackProps {
  people: Person[]
  // how many avatars to show before "+N"
  max?: number
  // the full count, when `people` is only the first few (a team of 2,000)
  total?: number
}

// A few avatars and a count, instead of every name.
export function AvatarStack({ people, max = 6, total = people.length }: AvatarStackProps) {
  const shown = people.slice(0, max)
  const more = total - shown.length
  return (
    <span className="avatar-stack">
      {shown.map((person) => (
        <Avatar key={person.id} person={person} size="sm" />
      ))}
      {more > 0 && (
        <span className="avatar-more">
          <span aria-hidden>+{more.toLocaleString('en')}</span>
          <span className="visually-hidden">and {more.toLocaleString('en')} more</span>
        </span>
      )}
    </span>
  )
}
