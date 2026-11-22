// Where text comments go in the gutter beside the document: each as close to
// level with its text as it can be without overlapping another.

export interface GutterNote {
  id: string
  // where its text is, from the top of the document
  anchor: number
  // where its text ends (its last line's foot), if not at the anchor
  end?: number
  height: number
  // the space above it, if not the layout's own (lines sit closer together)
  gap?: number
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
 * How high a note can go: while its text is in view, no higher than the gutter's top; once its text
 * has gone above the window, up from there as far as its text has gone, so it slides away with it
 * rather than jumping.
 */
export function lowestOf(note: { anchor: number; end?: number }, floor: GutterFloor | null): number {
  return floor === null ? -Infinity : floor.top - Math.max(0, floor.window - (note.end ?? note.anchor))
}

/**
 * Each note's top. In document order, each starts level with its text, or
 * just below the one before. With a floor, a note whose text is in view sits
 * at or below it, and one whose text has gone slides up with it. Nothing is pinned: an open note is drawn over the rest,
 * which are laid out as if it were closed.
 */
export function layoutNotes(notes: GutterNote[], gap = 12, floor: GutterFloor | null = null): Map<string, number> {
  const sorted = [...notes].sort((a, b) => a.anchor - b.anchor || a.id.localeCompare(b.id))
  const tops = new Map<string, number>()
  let bottom = -Infinity
  for (const note of sorted) {
    const top = Math.max(note.anchor, bottom + (note.gap ?? gap), lowestOf(note, floor))
    tops.set(note.id, top)
    bottom = top + note.height
  }
  return tops
}

/** How much of a thread a note shows: the card's sizes, and a pile standing for several. */
export type NoteSize = 'full' | 'short' | 'line' | 'pile'

const SIZES: NoteSize[] = ['full', 'short', 'line', 'pile']

export interface FitNote {
  id: string
  // where its text is, from the top of the document
  anchor: number
  // its height drawn full
  full: number
}

/** The heights of the sizes that don't depend on what's in them. */
export interface FixedHeights {
  short: number
  line: number
  // a pile is a line, and this much more for each of up to three notes under it
  pileStep: number
  // the space above a line or a pile, closer than between cards
  lineGap: number
}

/** A note, or a pile of them, as the gutter places it. */
export interface NoteUnit {
  ids: string[]
  size: NoteSize
  // as small as it goes: a line on its own, its text too far from the rest of its run to share a pile
  last?: boolean
}

/** The space above a unit: a line or a pile sits closer to what's above it than a card does. */
export function unitGap(unit: NoteUnit, heights: FixedHeights, gap: number): number {
  return unit.size === 'line' || unit.size === 'pile' ? heights.lineGap : gap
}

/** A unit's height at its size. */
export function unitHeight(unit: NoteUnit, full: (id: string) => number, heights: FixedHeights): number {
  switch (unit.size) {
    case 'full':
      return full(unit.ids[0]!)
    case 'short':
      return heights.short
    case 'line':
      return heights.line
    case 'pile':
      return heights.line + heights.pileStep * Math.min(3, unit.ids.length - 1)
  }
}

/**
 * Each note's size, so each stretch of the page keeps its cards near their text (the fit rule,
 * docs/handoff-page-comments.md). Every note starts full and is laid out as layoutNotes does. A run
 * is a note level with its text and the notes pushed down after it; a run with a note more than
 * `slack` below its text is crowded, and the most crowded goes down a size, all of it together:
 * full, short, line, then one pile. Again until no run is crowded, or every crowded run starts with
 * a pile. A note only gets smaller, so it ends.
 */
export function fitNotes(notes: FitNote[], heights: FixedHeights, gap: number, slack: number): NoteUnit[] {
  const sorted = [...notes].sort((a, b) => a.anchor - b.anchor || a.id.localeCompare(b.id))
  const byId = new Map(sorted.map((note) => [note.id, note]))
  const full = (id: string) => byId.get(id)!.full
  /** The runs of a layout, the crowded ones, and how far each one's last note sits below its text. */
  const look = (units: NoteUnit[]) => {
    const tops = layoutNotes(
      units.map((unit) => ({
        id: unit.ids[0]!,
        anchor: byId.get(unit.ids[0]!)!.anchor,
        height: unitHeight(unit, full, heights),
        gap: unitGap(unit, heights, gap),
      })),
      gap,
    )
    // the runs: each starts at a unit level with its text
    const runs: number[][] = []
    units.forEach((unit, i) => {
      const pushed = tops.get(unit.ids[0]!)! > byId.get(unit.ids[0]!)!.anchor + 0.5
      if (pushed && runs.length > 0) {
        runs.at(-1)!.push(i)
      } else {
        runs.push([i])
      }
    })
    // how far its farthest note sits below its text (the last one may be near its own, pushed only a
    // little, and hide the crowding before it)
    const drift = (run: number[]) =>
      Math.max(...run.map((i) => tops.get(units[i]!.ids[0]!)! - byId.get(units[i]!.ids[0]!)!.anchor))
    return {
      drift,
      crowded: runs.filter((run) => drift(run) > slack && units[run[0]!]!.size !== 'pile' && !units[run[0]!]!.last),
      // the units level with their text, each starting a run
      level: new Set(runs.map((run) => run[0]!)),
    }
  }
  let units: NoteUnit[] = sorted.map((note) => ({ ids: [note.id], size: 'full' }))
  for (let pass = 0; pass < sorted.length * SIZES.length + 1; pass++) {
    const { drift, crowded } = look(units)
    if (crowded.length === 0) {
      break
    }
    const worst = crowded.reduce((a, b) => (drift(b) > drift(a) ? b : a))
    const stepped = worst.map((i) => {
      const unit = units[i]!
      return { ...unit, size: SIZES[Math.min(SIZES.indexOf(unit.size) + 1, SIZES.length - 1)]! }
    })
    // a run that's become piles: a pile for each stretch of it whose texts are close (the next one's
    // within the pile as it would stand), and a line for one on its own
    const merged: NoteUnit[] = stepped.every((unit) => unit.size === 'pile') ? piles(stepped) : stepped
    units = [...units.slice(0, worst[0]!), ...merged, ...units.slice(worst.at(-1)! + 1)]
  }
  // a note stepped down with a run it was pushed into, and level with its text once the run was
  // smaller, grows back as far as it can without crowding anything: a quiet stretch keeps its room.
  // Only one level with its text: the rest of a run keep its size, a tidy column
  for (let i = 0; i < units.length; i++) {
    while (units[i]!.size !== 'full' && units[i]!.size !== 'pile' && look(units).level.has(i)) {
      const grown = [...units]
      grown[i] = { ids: units[i]!.ids, size: SIZES[SIZES.indexOf(units[i]!.size) - 1]! }
      if (look(grown).crowded.length > 0) {
        break
      }
      units = grown
    }
  }
  return units

  function piles(run: NoteUnit[]): NoteUnit[] {
    const out: NoteUnit[] = []
    let group: string[] = []
    let top = 0
    const close = () => {
      if (group.length > 0) {
        out.push(group.length === 1 ? { ids: group, size: 'line', last: true } : { ids: group, size: 'pile' })
      }
    }
    for (const unit of run) {
      const anchor = byId.get(unit.ids[0]!)!.anchor
      const reach = top + unitHeight({ ids: [...group, ...unit.ids], size: 'pile' }, full, heights) + heights.lineGap
      if (group.length > 0 && anchor <= reach) {
        group.push(...unit.ids)
      } else {
        close()
        group = [...unit.ids]
        top = anchor
      }
    }
    close()
    return out
  }
}
