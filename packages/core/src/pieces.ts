// How a file's new text is made from old text: a list of pieces, each either
// copied from a range of an old file (possibly a different one, for a move) or
// new text. Because every edit says exactly where each character came from,
// positions can be followed exactly: a comment, a block or a heading maps to
// wherever its characters went.
//
// The same structure describes a command (built precisely) and an upload
// (built from a diff), in either source offsets or plain-text offsets.
import { cleanupSemantic, type Diff, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, makeDiff } from '@sanity/diff-match-patch'

export type Piece =
  | { kind: 'copy'; file: string; start: number; end: number; moved: boolean }
  | {
      kind: 'text'
      text: string
      /** The old range this text stands in for, if any. */
      replaces: { file: string; start: number; end: number } | null
      /** True for a command's own replacement (`replace`, `rename-heading`): comments on the old text move onto it. */
      explicit: boolean
    }

export type Edit = {
  /** Old ranges [start, end) that are removed. Must not overlap. */
  deletes: Array<[number, number]>
  /** Pieces inserted at an old position. Several at one position keep their order. */
  inserts: Array<{ at: number; pieces: Piece[] }>
}

/** The pieces of one file after an edit to it. */
export function applyEdit(file: string, length: number, edit: Edit): Piece[] {
  const deletes = edit.deletes.filter(([s, e]) => e > s).toSorted((a, b) => a[0] - b[0])
  const inserts = edit.inserts
    .map((insert, order) => ({ ...insert, order }))
    .toSorted((a, b) => a.at - b.at || a.order - b.order)
  for (let i = 1; i < deletes.length; i++) {
    if (deletes[i]![0] < deletes[i - 1]![1]) {
      throw new Error('overlapping deletes')
    }
  }
  const pieces: Piece[] = []
  let pos = 0
  let d = 0
  let n = 0
  for (;;) {
    const next = Math.min(deletes[d]?.[0] ?? Infinity, inserts[n]?.at ?? Infinity, length)
    if (next > pos) {
      pieces.push({ kind: 'copy', file, start: pos, end: next, moved: false })
      pos = next
    }
    if (n < inserts.length && inserts[n]!.at === pos) {
      pieces.push(...inserts[n++]!.pieces)
      continue
    }
    if (n < inserts.length && inserts[n]!.at < pos) {
      throw new Error('insert inside a deleted range')
    }
    if (d < deletes.length && deletes[d]![0] === pos) {
      pos = deletes[d++]![1]
      continue
    }
    if (pos >= length) {
      break
    }
  }
  return merge(pieces)
}

function merge(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  for (const piece of pieces) {
    const last = out.at(-1)
    if (piece.kind === 'copy' && piece.end === piece.start) {
      continue
    }
    if (piece.kind === 'text' && piece.text === '' && !piece.replaces) {
      continue
    }
    if (
      last?.kind === 'copy' &&
      piece.kind === 'copy' &&
      last.file === piece.file &&
      last.end === piece.start &&
      last.moved === piece.moved
    ) {
      last.end = piece.end
      continue
    }
    out.push(piece.kind === 'copy' ? { ...piece } : piece)
  }
  return out
}

/** Builds a file's new text from its pieces. */
export function textOf(pieces: Piece[], oldText: (file: string) => string): string {
  return pieces.map((p) => (p.kind === 'copy' ? oldText(p.file).slice(p.start, p.end) : p.text)).join('')
}

export type Target = { file: string; offset: number; moved: boolean }
export type Replacement = { file: string; start: number; end: number; explicit: boolean }

type Segment = { start: number; end: number; file: string; at: number; moved: boolean }
type Replaced = { start: number; end: number; file: string; at: number; length: number; explicit: boolean }

/** Answers "where did this old character go?" for a set of new files built from pieces. */
export class PieceMap {
  readonly #copies = new Map<string, Segment[]>()
  readonly #replaced = new Map<string, Replaced[]>()

  constructor(newFiles: Map<string, Piece[]>) {
    for (const [file, pieces] of newFiles) {
      let at = 0
      for (const piece of pieces) {
        if (piece.kind === 'copy') {
          push(this.#copies, piece.file, { start: piece.start, end: piece.end, file, at, moved: piece.moved })
          at += piece.end - piece.start
        } else {
          if (piece.replaces) {
            push(this.#replaced, piece.replaces.file, {
              ...piece.replaces,
              file,
              at,
              length: piece.text.length,
              explicit: piece.explicit,
            })
          }
          at += piece.text.length
        }
      }
    }
    for (const list of this.#copies.values()) {
      list.sort((a, b) => a.start - b.start)
    }
    for (const list of this.#replaced.values()) {
      list.sort((a, b) => a.start - b.start)
    }
  }

  /** Where an old character was copied to, or null if it didn't survive. */
  map(file: string, offset: number): Target | null {
    const segment = find(this.#copies.get(file), offset)
    return segment ? { file: segment.file, offset: segment.at + offset - segment.start, moved: segment.moved } : null
  }

  /** The new text an old character was replaced by, if it was. */
  replacement(file: string, offset: number): Replacement | null {
    const replaced = find(this.#replaced.get(file), offset)
    return replaced
      ? { file: replaced.file, start: replaced.at, end: replaced.at + replaced.length, explicit: replaced.explicit }
      : null
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list) {
    list.push(value)
  } else {
    map.set(key, [value])
  }
}

function find<T extends { start: number; end: number }>(list: T[] | undefined, offset: number): T | null {
  if (!list) {
    return null
  }
  let lo = 0
  let hi = list.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const item = list[mid]!
    if (offset < item.start) {
      hi = mid - 1
    } else if (offset >= item.end) {
      lo = mid + 1
    } else {
      return item
    }
  }
  return null
}

/** Unchanged: every character maps to itself. */
export function identity(file: string, length: number): Piece[] {
  return length > 0 ? [{ kind: 'copy', file, start: 0, end: length, moved: false }] : []
}

const WORD_END = /[\p{L}\p{N}]+$/u
const WORD_START = /^[\p{L}\p{N}]+/u
const WORDY = /[\p{L}\p{N}]/u

/**
 * The same diff, with words replaced whole. A diff may keep the letters two words share (the "t" of
 * "three" and "two") and replace the rest, so a comment on the old words seems to have a
 * letter of them left, and follows that. Where a replacement starts or ends inside a word, the part
 * of the word kept goes into the replacement on both sides. Both diffs make the same text.
 */
export function wholeWords(diffs: Diff[]): Diff[] {
  const out: Diff[] = diffs.map(([op, text]) => [op, text])
  for (let i = 0; i < out.length; i++) {
    if (out[i]![0] === DIFF_EQUAL) {
      continue
    }
    // a run of edits, from i to j (exclusive): only a replacement, deleting and inserting
    let j = i
    while (j < out.length && out[j]![0] !== DIFF_EQUAL) {
      j++
    }
    const deleted = out.slice(i, j).filter(([op]) => op === DIFF_DELETE)
    const inserted = out.slice(i, j).filter(([op]) => op === DIFF_INSERT)
    if (deleted.length > 0 && inserted.length > 0) {
      let del = deleted.map(([, text]) => text).join('')
      let ins = inserted.map(([, text]) => text).join('')
      const before = out[i - 1]
      const after = out[j]
      const head = before && WORDY.test(del[0]!) && WORDY.test(ins[0]!) ? WORD_END.exec(before[1])?.[0] : undefined
      if (before && head) {
        before[1] = before[1].slice(0, -head.length)
        del = head + del
        ins = head + ins
      }
      const tail =
        after && WORDY.test(del.at(-1)!) && WORDY.test(ins.at(-1)!) ? WORD_START.exec(after[1])?.[0] : undefined
      if (after && tail) {
        after[1] = after[1].slice(tail.length)
        del += tail
        ins += tail
      }
      out.splice(i, j - i, [DIFF_DELETE, del], [DIFF_INSERT, ins])
      j = i + 2
    }
    i = j - 1
  }
  // equalities emptied, and the edits either side of one, run together
  const merged: Diff[] = []
  for (const [op, text] of out) {
    if (text === '') {
      continue
    }
    const last = merged.at(-1)
    if (op === DIFF_EQUAL && last?.[0] === DIFF_EQUAL) {
      last[1] += text
    } else if (op !== DIFF_EQUAL && last && last[0] !== DIFF_EQUAL) {
      // gather the run's deletions before its insertions
      let k = merged.length
      while (k > 0 && merged[k - 1]![0] !== DIFF_EQUAL) {
        k--
      }
      const run = [...merged.splice(k), [op, text] as Diff]
      const del = run
        .filter(([o]) => o === DIFF_DELETE)
        .map(([, t]) => t)
        .join('')
      const ins = run
        .filter(([o]) => o === DIFF_INSERT)
        .map(([, t]) => t)
        .join('')
      merged.push(...(del ? [[DIFF_DELETE, del] as Diff] : []), ...(ins ? [[DIFF_INSERT, ins] as Diff] : []))
    } else {
      merged.push([op, text])
    }
  }
  return merged
}

/**
 * The same diff, with lines deleted or inserted whole where it can be. A diff may keep one of two
 * equal characters ending lines (a full stop, say) where either would do: an edit that ends a line
 * deleting "month.\nEach pass ends with a review" before an unchanged ".\nSteps" keeps the
 * second full stop, so a line deleted (moved elsewhere) seems to have a character left in place.
 * Where what's kept up to the next line break also ends a line in the edit, the edit keeps that
 * one instead, and the rest of the edit is the lines after it, whole. Both diffs make the same
 * text: nothing is guessed.
 */
export function wholeLines(diffs: Diff[]): Diff[] {
  const out: Diff[] = []
  let group: Diff[] = []
  diffs.forEach((diff, i) => {
    if (diff[0] !== DIFF_EQUAL) {
      group.push(diff)
      return
    }
    const kept = diff[1]
    const lineEnd = kept.indexOf('\n')
    // what's kept up to its first line break (or its end, at the very end)
    const m = lineEnd >= 0 ? lineEnd : i === diffs.length - 1 ? kept.length : -1
    const p = m > 0 ? kept.slice(0, m) : null
    let rotated = false
    if (p !== null) {
      for (let g = 0; g < group.length && !rotated; g++) {
        const [op, text] = group[g]!
        for (let n = text.indexOf('\n'); n >= 0; n = text.indexOf('\n', n + 1)) {
          if (n >= m && text.slice(n - m, n) === p) {
            const before = text.slice(0, n - m)
            const rest: Diff[] = [
              ...group.slice(0, g),
              ...(before ? [[op, before] as Diff] : []),
              ...group.slice(g + 1),
            ]
            out.push(...rest, [DIFF_EQUAL, p], [op, text.slice(n) + p])
            if (kept.length > m) {
              out.push([DIFF_EQUAL, kept.slice(m)])
            }
            rotated = true
            break
          }
        }
      }
    }
    if (!rotated) {
      out.push(...group, diff)
    }
    group = []
  })
  out.push(...group)
  return out
}

/**
 * Pieces from a diff of `before` to `after`, for text with no command saying
 * what happened (an upload, or rewriting a section's body). A deletion
 * directly followed by an insertion becomes new text that replaces it, but not
 * explicitly, so comments on the old text don't move onto it. Short
 * coincidental matches are cleaned up first, so a rewritten sentence reads as
 * rewritten rather than keeping scattered letters.
 */
export function diffPieces(file: string, before: string, after: string, offset = 0): Piece[] {
  const diffs = wholeLines(wholeWords(cleanupSemantic(makeDiff(before, after, { timeout: 0, checkLines: true }))))
  const pieces: Piece[] = []
  let pos = 0
  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i]!
    if (op === DIFF_EQUAL) {
      pieces.push({ kind: 'copy', file, start: offset + pos, end: offset + pos + text.length, moved: false })
      pos += text.length
    } else if (op === DIFF_DELETE) {
      const next = diffs[i + 1]
      if (next?.[0] === DIFF_INSERT) {
        pieces.push({
          kind: 'text',
          text: next[1],
          replaces: { file, start: offset + pos, end: offset + pos + text.length },
          explicit: false,
        })
        i++
      }
      pos += text.length
    } else if (op === DIFF_INSERT) {
      const next = diffs[i + 1]
      if (next?.[0] === DIFF_DELETE) {
        pieces.push({
          kind: 'text',
          text,
          replaces: { file, start: offset + pos, end: offset + pos + next[1].length },
          explicit: false,
        })
        pos += next[1].length
        i++
      } else {
        pieces.push({ kind: 'text', text, replaces: null, explicit: false })
      }
    }
  }
  return merge(pieces)
}
