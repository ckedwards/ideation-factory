// Carrying IDs and comments from one version to the next, given a PieceMap
// that says where every old character went. Nothing here guesses: an ID or a
// comment either follows its own characters, or it doesn't follow at all.
import type { Anchor, AnchorState, IdeaFile, Ids } from './idea.ts'
import { type ParsedFile, plainIndexAt, plainIndexAtOrAfter, unitAt } from './markdown.ts'
import type { PieceMap } from './pieces.ts'

/** Which coordinates the PieceMap is in: source offsets (commands) or plain-text offsets (uploads). */
export type Space = 'source' | 'plain'

export type OldFile = { file: IdeaFile; parsed: ParsedFile }

/**
 * Gives each new unit the ID of the old unit whose characters (or explicit
 * replacement) all landed in it, when it's the only old unit that did and is
 * the same kind of thing (heading or not). Returns null where nothing follows.
 */
export function matchUnits(
  old: OldFile[],
  next: Map<string, ParsedFile>,
  map: PieceMap,
  space: Space,
): Map<string, Array<string | null>> {
  const claims = new Map<string, Array<{ id: string; heading: boolean }>>()
  for (const { file, parsed } of old) {
    parsed.units.forEach((unit, index) => {
      const [start, end] = space === 'source' ? [unit.start, unit.end] : [unit.plainStart, unit.plainEnd]
      if (end <= start) return
      let target: string | null = null
      let several = false
      for (let c = start; c < end && !several; c++) {
        const hit = map.map(file.id, c)
        // a heading only follows its own surviving text or an explicit rename: a heading
        // rewritten in a diff is a different heading (renames in place have their own rule)
        const replacement = hit ? null : map.replacement(file.id, c)
        const replaced = replacement && (unit.kind !== 'heading' || replacement.explicit) ? replacement : null
        const to = hit ? { file: hit.file, offset: hit.offset } : replaced && replaced.end > replaced.start ? { file: replaced.file, offset: replaced.start } : null
        if (!to) continue
        const parsedNew = next.get(to.file)
        if (!parsedNew) continue
        const u = space === 'source' ? unitAt(parsedNew.units, to.offset) : (parsedNew.plain.unit[to.offset] ?? -1)
        if (u < 0) continue
        const key = `${to.file}\u0000${u}`
        if (target === null) target = key
        else if (target !== key) several = true
      }
      if (target === null || several) return
      const list = claims.get(target) ?? []
      list.push({ id: file.unitIds[index]!, heading: unit.kind === 'heading' })
      claims.set(target, list)
    })
  }
  const out = new Map<string, Array<string | null>>()
  for (const [fileId, parsed] of next) out.set(fileId, parsed.units.map(() => null))
  for (const [key, list] of claims) {
    if (list.length !== 1) continue
    const [fileId, u] = key.split('\u0000') as [string, string]
    const unit = next.get(fileId)!.units[Number(u)]!
    if ((unit.kind === 'heading') !== list[0]!.heading) continue
    out.get(fileId)![Number(u)] = list[0]!.id
  }
  return out
}

/** Fills the units nothing followed into with new IDs. */
export function fillIds(matched: Map<string, Array<string | null>>, next: Map<string, ParsedFile>, ids: Ids): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [fileId, list] of matched) {
    const units = next.get(fileId)!.units
    out.set(
      fileId,
      list.map((id, i) => id ?? (units[i]!.kind === 'heading' ? ids.section() : ids.block())),
    )
  }
  return out
}

/** Where one old plain-text character went, in the new plain-text form. */
export interface PlainMapper {
  map(file: string, index: number): { file: string; index: number; moved: boolean } | null
  /** The new text that explicitly replaced this character (a `replace` command), as a plain-text range. */
  replacement(file: string, index: number): { file: string; start: number; end: number } | null
}

/** A PlainMapper for a PieceMap in source offsets: old plain → old source → new source → new plain. */
export function sourceMapper(map: PieceMap, oldFiles: Map<string, ParsedFile>, newFiles: Map<string, ParsedFile>): PlainMapper {
  return {
    map(file, index) {
      const source = oldFiles.get(file)?.plain.source[index]
      if (source === undefined) return null
      const to = map.map(file, source)
      if (!to) return null
      const plain = newFiles.get(to.file)?.plain
      if (!plain) return null
      const j = plainIndexAt(plain, to.offset)
      return j < 0 ? null : { file: to.file, index: j, moved: to.moved }
    },
    replacement(file, index) {
      const source = oldFiles.get(file)?.plain.source[index]
      if (source === undefined) return null
      const r = map.replacement(file, source)
      if (!r || !r.explicit) return null
      const plain = newFiles.get(r.file)?.plain
      if (!plain) return null
      return { file: r.file, start: plainIndexAtOrAfter(plain, r.start), end: plainIndexAtOrAfter(plain, r.end) }
    },
  }
}

/** A PlainMapper for a PieceMap already in plain-text offsets (an upload's diff). */
export function plainMapper(map: PieceMap): PlainMapper {
  return {
    map(file, index) {
      const to = map.map(file, index)
      return to ? { file: to.file, index: to.offset, moved: to.moved } : null
    },
    replacement: () => null,
  }
}

/**
 * Follows a text anchor:
 * - every character survived, together and unchanged: *exact* (or *moved*, if a move carried it);
 * - some survived: the largest run that stayed together, marked *changed*;
 * - none survived but the text was explicitly replaced: the replacement, *changed*;
 * - otherwise *outdated*.
 */
export function followText(
  anchor: Extract<Anchor, { kind: 'text' }>,
  mapper: PlainMapper,
  newFiles: Map<string, ParsedFile>,
): { state: AnchorState; anchor: Anchor | null } {
  type Hit = { file: string; index: number; moved: boolean }
  const runs: Hit[][] = []
  let survivors = 0
  let replacement: { file: string; start: number; end: number } | null = null
  let allReplaced = true
  for (let i = anchor.start; i < anchor.end; i++) {
    const hit = mapper.map(anchor.file, i)
    if (!hit) {
      const r = mapper.replacement(anchor.file, i)
      if (!r || (replacement && (r.file !== replacement.file || r.start !== replacement.start))) allReplaced = false
      else replacement = r
      continue
    }
    allReplaced = false
    survivors++
    const run = runs.at(-1)
    const last = run?.at(-1)
    if (run && last && last.file === hit.file && hit.index > last.index) run.push(hit)
    else runs.push([hit])
  }

  if (survivors === 0) {
    if (allReplaced && replacement && replacement.end > replacement.start) {
      const quote = newFiles.get(replacement.file)!.plain.text.slice(replacement.start, replacement.end)
      return { state: 'changed', anchor: { kind: 'text', file: replacement.file, start: replacement.start, end: replacement.end, quote } }
    }
    return { state: 'outdated', anchor: null }
  }

  const best = runs.reduce((a, b) => (b.length > a.length ? b : a))
  const file = best[0]!.file
  const text = newFiles.get(file)!.plain.text
  const length = anchor.end - anchor.start
  let start = best[0]!.index
  let end = best.at(-1)!.index + 1
  const whole = survivors === length && runs.length === 1 && end - start === length && text.slice(start, end) === anchor.quote
  if (!whole) {
    // a part that survived doesn't start or end with the space next to what was edited
    while (start < end && /\s/.test(text[start]!)) start++
    while (end > start && /\s/.test(text[end - 1]!)) end--
  }
  const quote = text.slice(start, end)
  // only spaces or punctuation left (the full stop of a rewritten sentence) isn't the same text
  if (!/[\p{L}\p{N}]/u.test(quote)) return { state: 'outdated', anchor: null }
  const state: AnchorState = !whole ? 'changed' : best.some((hit) => hit.moved) ? 'moved' : 'exact'
  return { state, anchor: { kind: 'text', file, start, end, quote } }
}

/** Combines a comment's state across the steps of a batch: the most disruptive one wins. */
export function worse(a: AnchorState, b: AnchorState): AnchorState {
  const order: AnchorState[] = ['exact', 'moved', 'changed', 'outdated']
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!
}
