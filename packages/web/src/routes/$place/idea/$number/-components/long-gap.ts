// Back after a long gap (docs/handoff-live-editing.md, choice 4, step 8): away too long for the
// server to have kept what was missed, so the page can't merge by the letter. Its file is compared
// with the draft paragraph by paragraph instead. What only you changed goes in; where someone else
// changed the same paragraph meanwhile, yours is kept here, and you choose. No full offline mode.
//
// Your changes are worked out against the file as the server last confirmed it here (core's
// draftChanges), and each is sent as it reads there (`was`): the server takes it if the draft still
// reads that way, and refuses it as outdated if someone else changed it. All at once first, the usual
// case; one by one if any is refused, so the rest still go in.
import type { DraftChange, EditorBlock } from '@ideaf/core'
import type { Draft } from './editing.tsx'

/** How a send went: taken, refused as outdated (someone else changed what it was made against), or failed. */
export type Sent = 'taken' | 'outdated' | { failed: string }

/** What's typed here sent: the changes the draft didn't take (someone else changed theirs), or why it failed. */
export async function sendEach(
  changes: DraftChange[],
  send: (changes: DraftChange[]) => Promise<Sent>,
): Promise<{ unsettled: DraftChange[] } | { failed: string }> {
  if (changes.length === 0) {
    return { unsettled: [] }
  }
  const all = await send(changes)
  if (all === 'taken') {
    return { unsettled: [] }
  }
  if (all !== 'outdated' || changes.length === 1) {
    return all === 'outdated' ? { unsettled: changes } : all
  }
  const unsettled: DraftChange[] = []
  for (const change of changes) {
    const one = await send([change])
    if (one === 'outdated') {
      unsettled.push(change)
    } else if (one !== 'taken') {
      return one
    }
  }
  return { unsettled }
}

/** One of your changes someone else also changed: what's yours, what the draft has now, and yours made on it. */
export interface NeedsALook {
  /** What happened, in a few words: "You both changed this". */
  what: string
  /** Your words (empty: you took it out). */
  yours: string
  /** The draft's words now (null: someone took it out). */
  theirs: string | null
  /** Your change, made against the draft as it is now; null if there's nothing left to do. */
  over: DraftChange | null
}

/**
 * A change the draft didn't take, against the draft as it is now (`now`): what to show, and the
 * change that puts yours over theirs. `mine` is the page's blocks in order, for where to put back a
 * paragraph someone else took out.
 */
export function needsALook(change: DraftChange, now: Draft, file: string, mine: EditorBlock[]): NeedsALook {
  const sources = new Map(now.files.flatMap((f) => f.units.map((u) => [u.id, u.source] as const)))
  const has = (id: string) => sources.has(id)
  // where a paragraph someone took out goes back: after the nearest one before it, here, that's left
  const placeOf = (id: string) => {
    const at = mine.findIndex((b) => b.id === id)
    for (let i = at - 1; i >= 0; i--) {
      const before = mine[i]!.id
      if (before && has(before)) {
        return { after: before }
      }
    }
    return { start: file }
  }
  // an insert's place, or the end of the file if what it was next to has gone
  const still = (at: Extract<DraftChange, { kind: 'insert' }>['at']) =>
    ('after' in at && !has(at.after)) || ('before' in at && !has(at.before)) ? { end: file } : at
  switch (change.kind) {
    case 'edit':
      return has(change.id)
        ? {
            what: 'You both changed this',
            yours: change.source,
            theirs: sources.get(change.id)!,
            over: { ...change, was: sources.get(change.id)! },
          }
        : {
            what: 'You changed this, and someone took it out',
            yours: change.source,
            theirs: null,
            over: { kind: 'insert', at: placeOf(change.id), markdown: change.source },
          }
    case 'delete':
      return {
        what: 'You took this out, and someone changed it',
        yours: '',
        theirs: sources.get(change.id) ?? null,
        over: has(change.id) ? { ...change, was: sources.get(change.id)! } : null,
      }
    case 'insert':
      return {
        what: 'You added this, and what it followed changed',
        yours: change.markdown,
        theirs: null,
        over: { ...change, at: still(change.at) },
      }
    case 'move':
      return {
        what: 'You moved this, and someone changed it',
        yours: change.was,
        theirs: sources.get(change.id) ?? null,
        over: has(change.id) ? { ...change, was: sources.get(change.id)!, to: still(change.to) } : null,
      }
    case 'move-text':
      return {
        what: 'You moved these words, and someone changed them',
        yours: change.old,
        theirs: sources.get(change.from) ?? null,
        over:
          has(change.from) && has(change.to.in)
            ? { ...change, was: { from: sources.get(change.from)!, to: sources.get(change.to.in)! } }
            : null,
      }
    case 'suggestion':
      // the page never makes one
      return { what: 'A suggestion', yours: change.new, theirs: null, over: null }
    case 'create-file':
    case 'rename-file':
    case 'delete-file':
      // nor these: files are made, renamed and deleted from the Files list
      return { what: 'A change to a file', yours: '', theirs: null, over: null }
  }
}
