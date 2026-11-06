// Where text comments go in the gutter beside the document: each as close to
// level with its text as it can be without overlapping another.

export interface GutterNote {
  id: string
  // where its text is, from the top of the document
  anchor: number
  height: number
}

/**
 * Each note's top. In document order, each starts level with its text, or
 * just below the one before. The active note sits exactly level with its
 * text, and the notes above it move up to make room.
 */
export function layoutNotes(notes: GutterNote[], active: string | null = null, gap = 12): Map<string, number> {
  const sorted = [...notes].sort((a, b) => a.anchor - b.anchor || a.id.localeCompare(b.id))
  const tops = new Map<string, number>()
  const pinned = sorted.findIndex((note) => note.id === active)
  const first = pinned < 0 ? 0 : pinned
  // from the active note (or the first) down
  let bottom = -Infinity
  for (let i = first; i < sorted.length; i++) {
    const note = sorted[i]!
    const top = i === pinned ? note.anchor : Math.max(note.anchor, bottom + gap)
    tops.set(note.id, top)
    bottom = top + note.height
  }
  // and up from it
  let ceiling = pinned < 0 ? Infinity : sorted[pinned]!.anchor
  for (let i = first - 1; i >= 0; i--) {
    const note = sorted[i]!
    const top = Math.min(note.anchor, ceiling - gap - note.height)
    tops.set(note.id, top)
    ceiling = top
  }
  return tops
}
