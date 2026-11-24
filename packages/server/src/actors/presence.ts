// Who is in an idea's draft, and where their carets are (docs/handoff-live-editing.md, step 4): held
// in the idea actor's memory, never stored. It changes many times a second and is worthless after a
// restart: if the actor moves to another node, each window's socket comes back and joins again.
//
// - **A window is an entity.** The same person in two windows is two, each with its own caret and color.
// - **Colors** are given out as windows arrive, the lowest of the eight not taken, and kept while
//   the window stays; past eight they repeat.
// - **The limit:** past it, a window isn't let in (it reads along); it's let in once someone leaves.
// - **Expiry:** a window not heard from in PRESENCE_TTL_MS is gone, so a node that died without
//   closing its sockets leaves no ghost carets behind. Windows send their caret at least every
//   few seconds while they're open.
// - **A session** is one socket of a window: a reconnect's new socket takes the window over, and the
//   old one closing late doesn't take it out.
import type { DraftCaret, DraftPresence } from '@ideaf/api'

/** How long a window is kept without a word from it. */
export const PRESENCE_TTL_MS = 30_000
const COLORS = 8

interface Present {
  user: string
  session: string
  color: number
  at: DraftCaret | null
  seen: number
}

export type Joined =
  | { joined: true; person: DraftPresence; people: DraftPresence[] }
  | { joined: false; people: DraftPresence[] }

export class DraftPresences {
  // in the order they arrived
  #windows = new Map<string, Present>()
  #arrivals = 0

  /** Everyone in the draft, in the order they arrived. */
  people(): DraftPresence[] {
    return [...this.#windows].map(([window, p]) => ({ window, user: p.user, color: p.color, at: p.at }))
  }

  get size(): number {
    return this.#windows.size
  }

  /** A window coming in (or back, on a new socket): let in unless `limit` windows are in already. */
  join(window: string, user: string, session: string, limit: number, now: number): Joined {
    const had = this.#windows.get(window)
    if (had && had.user === user) {
      had.session = session
      had.seen = now
      return { joined: true, person: this.#person(window, had), people: this.people() }
    }
    if (had || this.#windows.size >= limit) {
      return { joined: false, people: this.people() }
    }
    const taken = new Set([...this.#windows.values()].map((p) => p.color))
    const free = Array.from({ length: COLORS }, (_, i) => i + 1).find((c) => !taken.has(c))
    const color = free ?? (this.#arrivals % COLORS) + 1
    this.#arrivals++
    const present: Present = { user, session, color, at: null, seen: now }
    this.#windows.set(window, present)
    return { joined: true, person: this.#person(window, present), people: this.people() }
  }

  /**
   * A window's caret moved, or it's still there: null if the window isn't in, on this session; `moved`
   * says whether the caret is anywhere new (if not, nobody needs telling).
   */
  move(
    window: string,
    session: string,
    at: DraftCaret | null,
    now: number,
  ): { person: DraftPresence; moved: boolean } | null {
    const present = this.#windows.get(window)
    if (!present || present.session !== session) {
      return null
    }
    const was = present.at
    const moved =
      was === null || at === null
        ? was !== at
        : was.file !== at.file || was.anchor !== at.anchor || was.head !== at.head || was.version !== at.version
    present.at = at
    present.seen = now
    return { person: this.#person(window, present), moved }
  }

  /** A window's socket closed: whether it was the window's own (a reconnect's newer one keeps it). */
  leave(window: string, session: string): boolean {
    const present = this.#windows.get(window)
    if (!present || present.session !== session) {
      return false
    }
    this.#windows.delete(window)
    return true
  }

  /** The windows not heard from in PRESENCE_TTL_MS, taken out. */
  sweep(now: number): string[] {
    const gone = [...this.#windows].filter(([, p]) => now - p.seen > PRESENCE_TTL_MS).map(([w]) => w)
    for (const window of gone) {
      this.#windows.delete(window)
    }
    return gone
  }

  #person(window: string, p: Present): DraftPresence {
    return { window, user: p.user, color: p.color, at: p.at }
  }
}
