// Where comments are, in the document's terms. The API anchors a text comment
// on a range of the file's plain text (Markdown syntax removed, so re-wrapping
// or bolding doesn't move it), and a section comment on its heading's ID. The
// document marks Markdown source offsets. core's parse of the same file maps
// between them, as it does on the server.
import { parseMarkdown } from '@ideaf/core'

export interface Range {
  start: number
  end: number
}

/** A plain-text range as source offsets, to mark it in the document; null if it's past the end. */
export function toSource(source: string, plain: Range): Range | null {
  const { plain: text } = parseMarkdown(source)
  if (plain.start < 0 || plain.end <= plain.start || plain.end > text.text.length) {
    return null
  }
  return { start: text.source[plain.start]!, end: text.source[plain.end - 1]! + 1 }
}

/** A source range (a selection) as plain-text offsets, to comment on it; null if it has no text. */
export function toPlain(source: string, range: Range): Range | null {
  const { plain } = parseMarkdown(source)
  let start = -1
  let end = -1
  for (let i = 0; i < plain.source.length; i++) {
    const at = plain.source[i]!
    if (at >= range.start && at < range.end) {
      if (start < 0) {
        start = i
      }
      end = i + 1
    }
  }
  return start < 0 ? null : { start, end }
}

/** Where a section's heading starts, from its ID (the file's outline lists units in order, with their IDs). */
export function headingOffset(source: string, unitIds: readonly string[], section: string): number | null {
  const unit = parseMarkdown(source).units[unitIds.indexOf(section)]
  return unit?.kind === 'heading' ? unit.start : null
}

/** Where a block is in a file's Markdown, by its ID; null if it isn't there, or is a heading. */
export function blockRange(source: string, unitIds: readonly string[], block: string): Range | null {
  const unit = parseMarkdown(source).units[unitIds.indexOf(block)]
  return unit && unit.kind !== 'heading' ? { start: unit.start, end: unit.end } : null
}

/** The ID of the block (not a heading) that starts at an offset. */
export function blockAt(source: string, unitIds: readonly string[], start: number): string | null {
  const index = parseMarkdown(source).units.findIndex((unit) => unit.kind !== 'heading' && unit.start === start)
  return index < 0 ? null : (unitIds[index] ?? null)
}

/** What kind of block a block is, as its comment's card names it: Table, Diagram, List item. */
export function blockLabel(entry: { kind: string; source: string }): string {
  switch (entry.kind) {
    case 'table':
      return 'Table'
    case 'code':
      return /^\s*(```|~~~)\s*mermaid/.test(entry.source) ? 'Diagram' : 'Code'
    case 'list-item':
      return 'List item'
    case 'quote':
      return 'Quote'
    case 'paragraph':
      return /^\s*!\[/.test(entry.source) ? 'Image' : 'Paragraph'
    default:
      return 'Block'
  }
}

/** The ID of the section whose heading starts at an offset. */
export function sectionAt(source: string, unitIds: readonly string[], heading: number): string | null {
  const index = parseMarkdown(source).units.findIndex((unit) => unit.kind === 'heading' && unit.start === heading)
  return index < 0 ? null : (unitIds[index] ?? null)
}
