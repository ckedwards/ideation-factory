// What the page editor sends: the draft's blocks as they are on screen now, turned into the draft
// changes that make the draft read that way. The editor knows each block by the draft identity it
// carried through typing, cutting and pasting (docs/spike-editor-clipboard.md), or knows it as new
// text; this works out the rest.
//
// - **Edits** for blocks whose Markdown changed (a heading's #s set its level).
// - **Moves** for blocks out of their order, as few as keep the rest where they are: the longest
//   run of blocks still in their order stays, and the others move next to the block before them.
//   A heading moves with its section, as the move command does; blocks it takes along that belong
//   elsewhere move again after it.
// - **Deletions** for blocks no longer there. A heading deleted on its own keeps its section's
//   blocks: they move out ahead of it first, rather than going with it.
// - **Insertions** for new text, a run of new blocks at a time, next to the block before them.
// - **Words moved** between blocks (the editor saw them cut and pasted) go first, as move-text, so
//   their comments go with them.
//
// Every change is worked out on a copy of the draft with the same commands committing uses, so
// each one's `was` and place are the blocks as the change before left them, and the changes apply
// in the order given (change_draft takes them all or none).
import { applyBatch, occurrences } from './apply.ts'
import type { Position, TextPlace } from './batch.ts'
import { commandsFor, type DraftChange, unitSource } from './draft.ts'
import { type Idea, locate } from './idea.ts'
import { parseMarkdown, type UnitKind } from './markdown.ts'

/** A block on screen: the draft block it is, or null for new text, and its Markdown now. */
export interface EditorBlock {
  id: string | null
  source: string
}

/** Words the editor saw cut from one block and pasted into another. */
export interface MovedWords {
  from: string
  /** Their Markdown, as it was in `from` (once there). */
  old: string
  to: TextPlace
}

export type DraftChanges = { ok: true; changes: DraftChange[] } | { ok: false; message: string }

/**
 * The changes that make `draft` (the draft as the editor opened it) read as `files` does: each
 * file's blocks in order, by file ID. Files left out are as they were.
 */
export function draftChanges(
  draft: Idea,
  files: Record<string, EditorBlock[]>,
  words: MovedWords[] = [],
): DraftChanges {
  let idea = draft
  const changes: DraftChange[] = []
  const apply = (change: DraftChange) => {
    const built = commandsFor(idea, new Map(), change)
    if (!built.ok) {
      throw new Error(built.message)
    }
    if (built.commands.length > 0) {
      const applied = applyBatch(idea, [], { base: 1, steps: built.commands })
      if (!applied.ok) {
        throw new Error(applied.conflicts.map((c) => c.message).join('; '))
      }
      idea = applied.idea
    }
    changes.push(change)
  }
  const opened = new Map(draft.files.flatMap((f) => f.unitIds.map((id) => [id, unitSource(draft, id)!] as const)))
  const target = settle(files, opened)

  try {
    // words first: the blocks they left and landed in are then edited from where the move left them
    for (const w of words) {
      const from = unitSource(idea, w.from)
      const to = unitSource(idea, w.to.in)
      const near = 'before' in w.to ? w.to.before : w.to.after
      // words no longer where they were seen (typed over since, say): the edits below carry them
      if (from === null || to === null || occurrences(from, w.old).length !== 1 || occurrences(to, near).length !== 1) {
        continue
      }
      apply({ kind: 'move-text', from: w.from, old: w.old, to: w.to, was: { from, to } })
    }

    // edits: blocks that read differently now
    for (const blocks of Object.values(target)) {
      for (const block of blocks) {
        if (block.id === null) {
          continue
        }
        const now = unitSource(idea, block.id)!
        if (now.trim() === block.source.trim()) {
          continue
        }
        const edit: DraftChange = { kind: 'edit', id: block.id, source: block.source, was: now }
        // an edit that would make it another kind of block (so another block, with an ID of its
        // own): the block is new text, and the one it was goes
        if (losesItself(idea, edit, block.id)) {
          block.id = null
          continue
        }
        apply(edit)
      }
    }

    // moves: until every block that stays is in its place (files left out stay as they are)
    const wanted = new Set([
      ...Object.values(target).flatMap((blocks) => blocks.flatMap((b) => (b.id ? [b.id] : []))),
      ...draft.files.filter((f) => !(f.id in target)).flatMap((f) => f.unitIds),
    ])
    const limit = 3 * wanted.size + 10
    for (let round = 0; ; round++) {
      const out = outOfPlace(idea, target)
      if (!out) {
        break
      }
      if (round > limit) {
        return { ok: false, message: 'the blocks would not settle into their order' }
      }
      const was = unitSource(idea, out.id)
      if (was === null) {
        return { ok: false, message: `${out.id} lost its place as it moved` }
      }
      // a heading takes its section with it, so it can't go after a block still in its section:
      // the blocks of its section that belong before it move out above it instead
      const inside = out.id.startsWith('s') ? section(idea, out.id) : []
      if (out.after && inside.includes(out.after)) {
        const ahead = new Set(before(target, out.file, out.id))
        let previous: string | null = null
        for (const id of inside.filter((x) => ahead.has(x))) {
          // the first above the heading, the rest after it, so a list stays one list
          const to: Position = previous ? place(idea, out.file, previous, out.id, id) : { before: out.id }
          apply({ kind: 'move', id, to, was: unitSource(idea, id)! })
          previous = id
        }
        continue
      }
      apply({ kind: 'move', id: out.id, to: place(idea, out.file, out.after, out.before, out.id), was })
    }

    // deletions: headings first, keeping what's left of their sections; then blocks
    const gone = (id: string) => !wanted.has(id) && unitSource(idea, id) !== null
    for (const id of draft.files.flatMap((f) => f.unitIds)) {
      if (!id.startsWith('s') || !gone(id)) {
        continue
      }
      // what follows it in its section and stays: out ahead of it, in order
      for (const kept of section(idea, id).filter((u) => wanted.has(u))) {
        apply({ kind: 'move', id: kept, to: { before: id }, was: unitSource(idea, kept)! })
      }
      apply({ kind: 'delete', id, was: unitSource(idea, id)! })
    }
    for (const id of draft.files.flatMap((f) => f.unitIds)) {
      if (gone(id)) {
        apply({ kind: 'delete', id, was: unitSource(idea, id)! })
      }
    }

    // insertions: each run of new blocks, after the block before it
    for (const [file, blocks] of Object.entries(target)) {
      let after: string | null = null
      let run: string[] = []
      const flush = (before: string | null) => {
        if (run.length > 0) {
          apply({
            kind: 'insert',
            at: place(idea, file, after, before, null, listItem(run[0]!)),
            markdown: join(run),
          })
          run = []
        }
      }
      for (const block of blocks) {
        if (block.id === null) {
          run.push(block.source)
        } else {
          flush(block.id)
          after = block.id
        }
      }
      flush(null)
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, changes }
}

/**
 * The blocks as they'll be sent: empty new blocks left out, an identity the draft doesn't know (or
 * one on two blocks) taken off, a block made into another kind (a paragraph into a heading, a
 * heading into a list item) new text, as the draft can't make one kind into another and keep it the
 * same block, and a block that a paste split in two given back its identity on the half that kept
 * its text.
 */
function settle(files: Record<string, EditorBlock[]>, opened: Map<string, string>): Record<string, EditorBlock[]> {
  const seen = new Set<string>()
  const out: Record<string, EditorBlock[]> = {}
  for (const [file, blocks] of Object.entries(files)) {
    const list: EditorBlock[] = []
    for (const block of blocks) {
      const known = block.id !== null && opened.has(block.id) && !seen.has(block.id)
      if (known) {
        seen.add(block.id!)
      }
      // emptied: it's gone. An empty bullet, quote or heading (`-`, `>`, `##`) is a block, and saved
      if (block.source.trim() === '') {
        continue
      }
      const same = known && kindOf(block.source) === kindOf(opened.get(block.id!)!)
      list.push({ id: same ? block.id : null, source: block.source })
    }
    // a split: the half that kept more of the block's text keeps its identity
    for (let i = 0; i < list.length; i++) {
      const block = list[i]!
      if (block.id === null) {
        continue
      }
      const was = opened.get(block.id)!.trim()
      const own = kept(was, block.source.trim())
      for (const j of [i - 1, i + 1]) {
        const other = list[j]
        if (other && other.id === null && kept(was, other.source.trim()) > own) {
          list[j] = { id: block.id, source: other.source }
          list[i] = { id: null, source: block.source }
          break
        }
      }
    }
    out[file] = list
  }
  return out
}

/** Whether an edit, applied, leaves no block with the ID it edited. */
function losesItself(idea: Idea, edit: DraftChange, id: string): boolean {
  const built = commandsFor(idea, new Map(), edit)
  if (!built.ok || built.commands.length === 0) {
    return false
  }
  const applied = applyBatch(idea, [], { base: 1, steps: built.commands })
  return applied.ok && unitSource(applied.idea, id) === null
}

/** The kind of block some Markdown is (its first). */
const kindOf = (source: string): UnitKind | null => parseMarkdown(source).units[0]?.kind ?? null

/** How much of `was` a text kept: its common start and end with it. */
function kept(was: string, text: string): number {
  let start = 0
  while (start < was.length && start < text.length && was[start] === text[start]) {
    start++
  }
  let end = 0
  while (end < was.length - start && end < text.length - start && was.at(-1 - end) === text.at(-1 - end)) {
    end++
  }
  return start + end
}

/**
 * The first block, in the order wanted, that isn't where it should be: in another file, or not in
 * the longest run of blocks already in their order. With the block it should come after.
 */
function outOfPlace(
  idea: Idea,
  target: Record<string, EditorBlock[]>,
): { id: string; file: string; after: string | null; before: string | null } | null {
  for (const [file, blocks] of Object.entries(target)) {
    const order = idea.files.find((f) => f.id === file)?.unitIds ?? []
    const ids = blocks.flatMap((b) => (b.id ? [b.id] : []))
    const at = ids.map((id) => order.indexOf(id))
    const stays = longestRun(at)
    for (let i = 0; i < ids.length; i++) {
      if (!stays.has(i)) {
        return { id: ids[i]!, file, after: i > 0 ? ids[i - 1]! : null, before: ids[i + 1] ?? null }
      }
    }
    // in order, but with something else between that belongs elsewhere: settled by later moves, or
    // a deletion
  }
  return null
}

/** The indexes of the longest increasing run of positions (ignoring -1, not in this file). */
function longestRun(at: number[]): Set<number> {
  const tails: number[] = []
  const back: number[] = Array.from({ length: at.length }, () => -1)
  for (let i = 0; i < at.length; i++) {
    if (at[i]! < 0) {
      continue
    }
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (at[tails[mid]!]! < at[i]!) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    back[i] = lo > 0 ? tails[lo - 1]! : -1
    tails[lo] = i
  }
  const run = new Set<number>()
  for (let i = tails.at(-1) ?? -1; i >= 0; i = back[i]!) {
    run.add(i)
  }
  return run
}

/**
 * The place between `after` and `before` (the blocks either side of it, as wanted) in `file`, for
 * a block (`moving`, or new text, a list item or not).
 *
 * - **Right after a heading** is before what follows it, as "after" a heading is after its whole
 *   section.
 * - **A list item** goes before the list item it should precede, rather than after a paragraph,
 *   so it starts that list rather than one of its own.
 * - **Right after a list item,** anything but a list item goes before what follows, so it doesn't
 *   continue the list.
 */
function place(
  idea: Idea,
  file: string,
  after: string | null,
  before: string | null,
  moving: string | null,
  item = false,
): Position {
  const kindOf = (id: string) => {
    const at = locate(idea, id)
    return at ? at.parsed.units[at.unit]!.kind : null
  }
  const isItem = moving ? kindOf(moving) === 'list-item' : item
  const next = before && before !== moving && locate(idea, before)?.file.id === file ? before : null
  if (isItem && next && kindOf(next) === 'list-item' && (after === null || kindOf(after) !== 'list-item')) {
    return { before: next }
  }
  if (after === null) {
    return next ? { before: next } : { start: file }
  }
  const kind = kindOf(after)
  if (kind !== 'heading' && (kind !== 'list-item' || isItem)) {
    return { after }
  }
  const at = locate(idea, after)!
  const following = at.file.unitIds.slice(at.unit + 1).find((id) => id !== moving)
  return following ? { before: following } : { end: at.file.id }
}

/** The blocks that come before one, in a file's order as wanted. */
function before(target: Record<string, EditorBlock[]>, file: string, id: string): string[] {
  const ids = (target[file] ?? []).flatMap((b) => (b.id ? [b.id] : []))
  return ids.slice(0, Math.max(0, ids.indexOf(id)))
}

/** The blocks after a heading, up to the next heading of its level or above. */
function section(idea: Idea, heading: string): string[] {
  const at = locate(idea, heading)!
  const level = at.parsed.units[at.unit]!.level
  const out: string[] = []
  for (let i = at.unit + 1; i < at.parsed.units.length; i++) {
    const unit = at.parsed.units[i]!
    if (unit.kind === 'heading' && unit.level <= level) {
      break
    }
    out.push(at.file.unitIds[i]!)
  }
  return out
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])(\s|$)/
const listItem = (source: string) => LIST_ITEM.test(source)

/** New blocks as one insertion: list items one under another, the rest a blank line apart. */
function join(sources: string[]): string {
  return sources.reduce(
    (all, s, i) => (i === 0 ? s : `${all}${listItem(s) && listItem(sources[i - 1]!) ? '\n' : '\n\n'}${s}`),
    '',
  )
}

/**
 * The blocks of some Markdown (the whole file, as the Markdown side of the editor has it), each
 * known as the draft block it was where that can be told: by its text, unchanged, in order (the
 * longest run of them), and between those, a changed block of the same kind in the same place.
 * The rest are new text, and the draft's blocks not matched are gone.
 */
export function blocksOfSource(
  was: Array<{ id: string; source: string; kind: UnitKind }>,
  source: string,
): EditorBlock[] {
  const parsed = parseMarkdown(source)
  const now = parsed.units.map((u) => ({ source: source.slice(u.start, u.end), kind: u.kind }))
  const ids: Array<string | null> = now.map(() => null)
  // unchanged blocks: the longest common run, by their text
  const same = commonRun(
    was.map((w) => w.source.trim()),
    now.map((n) => n.source.trim()),
  )
  // between them, changed blocks of the same kind, in order
  const anchors = [[-1, -1] as [number, number], ...same, [was.length, now.length] as [number, number]]
  for (let a = 0; a < anchors.length - 1; a++) {
    const [wi, ni] = anchors[a]!
    const [wj, nj] = anchors[a + 1]!
    if (a > 0) {
      ids[ni] = was[wi]!.id
    }
    let w = wi + 1
    for (let n = ni + 1; n < nj && w < wj; n++) {
      const match = was.slice(w, wj).findIndex((x) => x.kind === now[n]!.kind)
      if (match >= 0) {
        ids[n] = was[w + match]!.id
        w += match + 1
      }
    }
  }
  return now.map((n, i) => ({ id: ids[i]!, source: n.source }))
}

/** The longest common run of two lists of texts: pairs of indexes, in order. */
function commonRun(a: string[], b: string[]): Array<[number, number]> {
  const rows = a.length + 1
  const cols = b.length + 1
  const len = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      len[i]![j] = a[i] === b[j] ? len[i + 1]![j + 1]! + 1 : Math.max(len[i + 1]![j]!, len[i]![j + 1]!)
    }
  }
  const out: Array<[number, number]> = []
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      out.push([i, j])
      i++
      j++
    } else if (len[i + 1]![j]! >= len[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return out
}
