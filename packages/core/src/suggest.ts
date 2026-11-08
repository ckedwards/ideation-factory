// Suggested edits: a comment on a selection, with a replacement for its text.
//
// - **What it replaces:** the selection's source, widened to whole formatting,
//   so a replacement can't leave half of `**bold**` behind. Selecting "line
//   sync" in `**Offline** sync` takes `**Offline** sync`; the suggester edits
//   that. A selection inside formatting ("Offl") stays inside it.
// - **Accepting it:** a `replace` of that source in the block where the comment
//   is now, so a suggestion survives its paragraph moving, or changing
//   elsewhere. If the source occurs more than once there, the one at the
//   comment is picked by taking in surrounding text until it's unique.
import type { Nodes } from 'mdast'
import { applyBatch, type BatchResult, occurrences, sectionExtent } from './apply.ts'
import type { Command } from './batch.ts'
import { type Anchor, type Comment, fileById, type Idea } from './idea.ts'
import { markdownTree, parseMarkdown, type ParsedFile } from './markdown.ts'

/** Inline syntax a replacement must take whole: its markers sit around the text a selection covers. */
const INLINE = new Set([
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
  'inlineCode',
  'image',
  'imageReference',
  'footnoteReference',
  'html',
])

type Where = { ok: true; old: string } | { ok: false; message: string }

/** The source a suggestion on this text replaces, or why there can't be one. */
export function suggestionSource(idea: Idea, anchor: Anchor): Where {
  if (anchor.kind !== 'text') {
    return { ok: false, message: 'a suggestion is on a selection of text' }
  }
  const range = sourceRange(idea, anchor)
  if (!range.ok) {
    return range
  }
  const { source } = range
  let [start, end] = [range.start, range.end]
  const inline: Array<[number, number]> = []
  const visit = (node: Nodes) => {
    const s = node.position?.start.offset
    const e = node.position?.end.offset
    if (s === undefined || e === undefined || e <= range.unitStart || s >= range.unitEnd) {
      return
    }
    if (INLINE.has(node.type)) {
      inline.push([s, e])
    }
    if ('children' in node) {
      for (const child of node.children) {
        visit(child)
      }
    }
  }
  visit(markdownTree(source))
  // widen to every piece of syntax the range cuts through, until none is cut
  for (let changed = true; changed;) {
    changed = false
    for (const [s, e] of inline) {
      // cut: it overlaps the range, but neither holds the other (the range is always within content, never markers)
      const cut = s < end && e > start && (s < start || e > end) && !(s <= start && e >= end)
      if (cut) {
        ;[start, end] = [Math.min(start, s), Math.max(end, e)]
        changed = true
      }
    }
  }
  return { ok: true, old: source.slice(start, end) }
}

/**
 * The `replace` that accepting a suggestion applies, from where its comment is
 * now, or why it no longer applies.
 */
export function suggestionCommand(
  idea: Idea,
  anchor: Anchor | null,
  suggestion: { old: string; new: string },
  addresses: string[],
): { ok: true; command: Command } | { ok: false; message: string } {
  if (!anchor) {
    return { ok: false, message: "its text isn't in the latest version" }
  }
  const range = sourceRange(idea, anchor)
  if (!range.ok) {
    return range
  }
  const { source, parsed, unit, unitId } = range
  const u = parsed.units[unit]!
  // the occurrences in the comment's own block, nearest it first
  const here = occurrences(source.slice(u.start, u.end), suggestion.old)
    .map((i) => i + u.start)
    .sort((a, b) => Math.abs(a - range.start) - Math.abs(b - range.start))
  const at = here[0]
  if (at === undefined) {
    return { ok: false, message: 'the text it changes has changed since' }
  }
  const command = uniqueReplace(parsed, unit, unitId, at, at + suggestion.old.length, suggestion.new, addresses)
  return command
    ? { ok: true, command }
    : { ok: false, message: 'its text occurs more than once, and can’t be told apart' }
}

/**
 * A `replace` of source [at, end) in a unit with `replacement`, taking in
 * surrounding text from the unit until what it replaces occurs once in what
 * replace searches (the block, or a heading's whole section). Null if even the
 * whole unit isn't unique there.
 */
export function uniqueReplace(
  parsed: ParsedFile,
  unit: number,
  unitId: string,
  at: number,
  end: number,
  replacement: string,
  addresses: string[] = [],
): Command | null {
  const { source } = parsed
  const u = parsed.units[unit]!
  const [scopeStart, scopeEnd] = u.kind === 'heading' ? sectionExtent(parsed, unit) : [u.start, u.end]
  const scope = source.slice(scopeStart, scopeEnd)
  for (let k = 0; ; k++) {
    const from = Math.max(u.start, at - k)
    const to = Math.min(u.end, end + k)
    const old = source.slice(from, to)
    if (old.length > 0 && occurrences(scope, old).length === 1) {
      const next = source.slice(from, at) + replacement + source.slice(end, to)
      return { command: 'replace', in: unitId, old, new: next, ...(addresses.length ? { addresses } : {}) }
    }
    if (from === u.start && to === u.end) {
      return null
    }
  }
}

/** A text anchor's source range, and the unit it's in. */
function sourceRange(idea: Idea, anchor: Anchor) {
  if (anchor.kind !== 'text') {
    return { ok: false as const, message: 'a suggestion is on a selection of text' }
  }
  const file = fileById(idea, anchor.file)
  if (!file) {
    return { ok: false as const, message: "its file isn't in this version" }
  }
  const parsed = parseMarkdown(file.source)
  const { plain } = parsed
  const unit = plain.unit[anchor.start] ?? -1
  if (anchor.end <= anchor.start || anchor.end > plain.text.length || unit < 0 || plain.unit[anchor.end - 1] !== unit) {
    return { ok: false as const, message: 'a suggestion must stay within one block' }
  }
  const u = parsed.units[unit]!
  return {
    ok: true as const,
    source: file.source,
    parsed,
    unit,
    unitId: file.unitIds[unit]!,
    unitStart: u.start,
    unitEnd: u.end,
    start: plain.source[anchor.start]!,
    end: plain.source[anchor.end - 1]! + 1,
  }
}

export interface Suggestion {
  id: string
  /** Where its comment is in this version; null if it's outdated. */
  anchor: Anchor | null
  old: string
  new: string
}

export type AcceptResult =
  /** The suggestions that apply, as one batch applied: a step for each, in order. */
  | {
      ok: true
      applied: Extract<BatchResult, { ok: true }>
      commands: Command[]
      accepted: string[]
      skipped: Skipped[]
    }
  | { ok: false; skipped: Skipped[] }

export type Skipped = { id: string; message: string }

/**
 * Accepts suggestions together: one batch, a step for each. One that no longer
 * applies (its text changed or gone, or overlapping one before it) is left
 * out, saying why, and the rest still land.
 */
export function acceptSuggestions(
  idea: Idea,
  comments: Comment[],
  base: number,
  suggestions: Suggestion[],
): AcceptResult {
  const skipped: Skipped[] = []
  let steps: Array<{ id: string; command: Command }> = []
  for (const s of suggestions) {
    const built = suggestionCommand(idea, s.anchor, s, [s.id])
    if (built.ok) {
      steps.push({ id: s.id, command: built.command })
    } else {
      skipped.push({ id: s.id, message: built.message })
    }
  }
  // each round drops the steps that conflicted; what's left either applies or runs out
  while (steps.length > 0) {
    const applied = applyBatch(idea, comments, { base, steps: steps.map((s) => s.command) })
    if (applied.ok) {
      return { ok: true, applied, commands: steps.map((s) => s.command), accepted: steps.map((s) => s.id), skipped }
    }
    const failed = new Set(applied.conflicts.map((c) => c.step))
    for (const c of applied.conflicts) {
      skipped.push({
        id: steps[c.step]!.id,
        message: c.reason === 'no_match' ? 'its text changed, by a suggestion accepted with it' : c.message,
      })
    }
    steps = steps.filter((_, i) => !failed.has(i))
  }
  return { ok: false, skipped }
}
