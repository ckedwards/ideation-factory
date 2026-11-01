// A person as components show them. Pages map the API's users onto this.
export interface Person {
  id: string
  name: string
  handle?: string
  // a picture; without one, initials on a color picked from the ID
  avatarUrl?: string
  // marked inactive by a site admin (e.g. they left): read only
  inactive?: boolean
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? '?'
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

const AVATAR_COLORS = 8

// The same person always gets the same color, on every page.
export function avatarColor(id: string): number {
  let hash = 2166136261
  for (const ch of id) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619)
  }
  return ((hash >>> 0) % AVATAR_COLORS) + 1
}

export function describePerson(person: Person): string {
  return [person.name, person.handle && `@${person.handle}`, person.inactive && 'inactive'].filter(Boolean).join(' · ')
}
