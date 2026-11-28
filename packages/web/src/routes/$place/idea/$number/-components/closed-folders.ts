// Which of an idea's folders are closed in its Files tree: kept in this browser, per idea, not on the
// server or shared (docs: Files in the browser, choice 8). Every folder starts open.
import { useCallback, useState } from 'react'

const key = (idea: string) => `ideaf:files:closed:${idea}`

function stored(idea: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(idea)) ?? '[]')
    return Array.isArray(value) ? value.filter((f): f is string => typeof f === 'string') : []
  } catch {
    return []
  }
}

/** The idea's closed folders, and setting them (kept for the next visit, where the browser allows). */
export function useClosedFolders(idea: string): [string[], (closed: string[]) => void] {
  const [closed, setClosed] = useState(() => stored(idea))
  const set = useCallback(
    (next: string[]) => {
      setClosed(next)
      try {
        localStorage.setItem(key(idea), JSON.stringify(next))
      } catch {
        // not kept: the choice lasts as long as the page
      }
    },
    [idea],
  )
  return [closed, set]
}
