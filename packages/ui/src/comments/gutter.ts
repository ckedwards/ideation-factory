// Where text comments go in the gutter beside the document: each as close to
// level with its text as it can be without overlapping another.

export interface GutterNote {
  id: string
  // where its text is, from the top of the document
  anchor: number
  // where its text ends (its last line's foot), if not at the anchor
  end?: number
  height: number
}

/**
 * Where the gutter can be seen, from the top of the document: its top edge, and the top of the
 * window the document is read in. A note whose text ends below the window's top is in view, and
 * goes no higher than the gutter's top edge, where it would be cut off.
 */
export interface GutterFloor {
  top: number
  window: number
}

/**
 * Each note's top. In document order, each starts level with its text, or
 * just below the one before. The active note sits exactly level with its
 * text, and the notes above it move up to make room. With a floor, a note
 * whose text is in view sits at or below it; the active note gives up its
 * place if it would push one of those above it.
 */
export function layoutNotes(
  notes: GutterNote[],
  active: string | null = null,
  gap = 12,
  floor: GutterFloor | null = null,
): Map<string, number> {
  const sorted = [...notes].sort((a, b) => a.anchor - b.anchor || a.id.localeCompare(b.id))
  const inView = (note: GutterNote) => floor !== null && (note.end ?? note.anchor) > floor.window
  const lowest = (note: GutterNote) => (floor && inView(note) ? floor.top : -Infinity)
  const pinned = sorted.findIndex((note) => note.id === active)
  const tops = place(sorted, pinned, gap, lowest)
  if (pinned >= 0 && sorted.some((note) => inView(note) && tops.get(note.id)! < floor!.top - 0.5)) {
    return place(sorted, -1, gap, lowest)
  }
  return tops
}

function place(
  sorted: GutterNote[],
  pinned: number,
  gap: number,
  lowest: (note: GutterNote) => number,
): Map<string, number> {
  const tops = new Map<string, number>()
  const first = pinned < 0 ? 0 : pinned
  // from the active note (or the first) down
  let bottom = -Infinity
  for (let i = first; i < sorted.length; i++) {
    const note = sorted[i]!
    const top = i === pinned ? Math.max(note.anchor, lowest(note)) : Math.max(note.anchor, bottom + gap, lowest(note))
    tops.set(note.id, top)
    bottom = top + note.height
  }
  // and up from it
  let ceiling = pinned < 0 ? Infinity : tops.get(sorted[pinned]!.id)!
  for (let i = first - 1; i >= 0; i--) {
    const note = sorted[i]!
    const top = Math.min(note.anchor, ceiling - gap - note.height)
    tops.set(note.id, top)
    ceiling = top
  }
  return tops
}
