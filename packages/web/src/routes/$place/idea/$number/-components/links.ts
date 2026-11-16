// An idea's addresses, like a pull request's: its overview at
// /mobile/idea/9 (or /@riley/idea/3 for someone's own), its files at /files
// (?v= for an older version), and what changed between two versions at
// /changes/1..3, or /changes/1.. for everything since v1, following new
// versions as they come. ?file= picks the file in either, and ?comment= a comment
// on the files page, opened where it is.

import { ideaPath } from '@ideaf/api'

export interface IdeaLinks {
  overview: string
  files(at?: { v?: number | undefined; file?: string | undefined; comment?: string | undefined }): string
  /** From one version to another, or (without `to`) to the latest, whatever it becomes. */
  changes(from: number, to?: number | undefined, file?: string | undefined): string
  /** Who has access, and moving it to another team. */
  sharing: string
  move: string
}

export function ideaLinks(place: string, number: number): IdeaLinks {
  const overview = ideaPath(place, number)
  const query = (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams()
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(name, String(value))
      }
    }
    const text = search.toString()
    return text ? `?${text}` : ''
  }
  return {
    overview,
    files: ({ v, file, comment } = {}) => `${overview}/files${query({ file, v, comment })}`,
    changes: (from, to, file) => `${overview}/changes/${from}..${to ?? ''}${query({ file })}`,
    sharing: `${overview}/sharing`,
    move: `${overview}/move`,
  }
}

/** A range from a URL: 1..3, or 1.. (to the latest); null if it isn't one. */
export function parseRange(range: string): { from: number; to: number | null } | null {
  const match = /^(\d+)\.\.(\d*)$/.exec(range)
  if (!match) {
    return null
  }
  const from = Number(match[1])
  const to = match[2] ? Number(match[2]) : null
  return from >= 1 && (to === null || to > from) ? { from, to } : null
}
