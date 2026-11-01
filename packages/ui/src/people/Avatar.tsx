import { avatarColor, describePerson, initials, type Person } from './person.ts'
import './Avatar.css'

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

export interface AvatarProps {
  person: Person
  size?: AvatarSize
  // beside the person's name, the avatar adds nothing for a screen reader
  decorative?: boolean
}

export function Avatar({ person, size = 'md', decorative = false }: AvatarProps) {
  const label = describePerson(person)
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }
  return (
    <span
      className={`avatar avatar-${size}`}
      data-color={avatarColor(person.id)}
      data-inactive={person.inactive || undefined}
      title={label}
      {...a11y}
    >
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person.name)}
    </span>
  )
}
