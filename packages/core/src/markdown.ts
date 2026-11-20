// Parsing one Markdown file into what the rest of core works with:
//
// - **Units:** the addressable pieces of a file, in document order. Headings,
//   and the blocks between them: paragraphs, list items, code blocks, tables,
//   quotes, and a few kinds with no text (HTML, thematic breaks, front matter,
//   link definitions). Units never overlap. A list item's unit is its own
//   content; its nested items are units of their own.
// - **Sections:** each heading starts one, running until the next heading of
//   the same or a higher level.
// - **The plain-text form:** each unit's text with Markdown syntax removed and
//   whitespace collapsed, units separated by "\n", with the source offset of
//   every character. Comments are anchored on it, so re-wrapping a paragraph or
//   adding bold doesn't disturb them.
//
// The web app must parse with the same libraries (remark is built on them), so
// source positions agree everywhere.
import type { Nodes, Parents, Root, RootContent } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { frontmatter } from 'micromark-extension-frontmatter'
import { gfm } from 'micromark-extension-gfm'

export type UnitKind =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'code'
  | 'table'
  | 'quote'
  | 'footnote'
  | 'html'
  | 'thematic-break'
  | 'front-matter'
  | 'definition'

export interface Unit {
  kind: UnitKind
  /** The unit's own content, as source offsets [start, end). */
  start: number
  end: number
  /** What deleting or moving the unit acts on. Wider than start/end only for a list item with nested items. */
  extentStart: number
  extentEnd: number
  /** Heading level, 1–6 (headings only). */
  level: number
  /** Column the unit starts at, so text inserted next to a nested list item can be indented to match. */
  indent: number
  /** The unit's range in the file's plain-text form [plainStart, plainEnd). Empty for kinds with no text. */
  plainStart: number
  plainEnd: number
}

export interface Section {
  /** Index of its heading in `units`. */
  heading: number
  level: number
  /** Index of the enclosing section in `sections`, or null at the top. */
  parent: number | null
  /** Index of the last unit before its first subsection (its own body ends here). */
  bodyLast: number
  /** Index of the last unit in the section, subsections included. */
  last: number
}

export interface PlainText {
  text: string
  /** Source offset of each character of `text`. Non-decreasing. */
  source: number[]
  /** The unit each character belongs to, or -1 for the "\n" between units. */
  unit: number[]
}

export interface ParsedFile {
  source: string
  units: Unit[]
  sections: Section[]
  plain: PlainText
}

const cache = new Map<string, ParsedFile>()

export function parseMarkdown(source: string): ParsedFile {
  const hit = cache.get(source)
  if (hit) {
    return hit
  }
  const parsed = parse(source)
  if (cache.size > 500) {
    cache.clear()
  }
  cache.set(source, parsed)
  return parsed
}

// The syntax tree (mdast), with every node's source offsets. The web app renders
// from this, so what it shows and where comments land come from one parser.
export function markdownTree(source: string): Root {
  return fromMarkdown(source, {
    extensions: [gfm(), frontmatter()],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown()],
  })
}

/**
 * Some Markdown as it reads, on one line: its plain text with the whitespace collapsed, so a
 * comment's excerpt shows no syntax. Markdown with no text (raw HTML alone, say) is its source.
 */
export function plainLine(markdown: string): string {
  return parseMarkdown(markdown).plain.text.replace(/\s+/g, ' ').trim() || markdown.replace(/\s+/g, ' ').trim()
}

function parse(source: string): ParsedFile {
  const tree = markdownTree(source)
  const units: Unit[] = []
  const chars: string[] = []
  const offsets: number[] = []
  const owners: number[] = []
  let previousEnd = 0

  const add = (kind: UnitKind, node: Nodes, start: number, end: number, extentEnd: number, textOf: () => Raw) => {
    const raw = textOf()
    const collapsed = collapse(raw)
    if (collapsed.text.length > 0 && chars.length > 0) {
      chars.push('\n')
      offsets.push(previousEnd)
      owners.push(-1)
    }
    if (collapsed.text.length > 0) {
      previousEnd = end
    }
    const plainStart = chars.length
    for (let i = 0; i < collapsed.text.length; i++) {
      chars.push(collapsed.text[i]!)
      offsets.push(collapsed.source[i]!)
      owners.push(units.length)
    }
    units.push({
      kind,
      start,
      end,
      extentStart: start,
      extentEnd,
      level: node.type === 'heading' ? node.depth : 0,
      indent: (node.position?.start.column ?? 1) - 1,
      plainStart,
      plainEnd: chars.length,
    })
  }

  const visit = (node: RootContent) => {
    const start = node.position!.start.offset!
    const end = node.position!.end.offset!
    switch (node.type) {
      case 'heading':
        return add('heading', node, start, end, end, () => textOf(node, source))
      case 'paragraph':
        return add('paragraph', node, start, end, end, () => textOf(node, source))
      case 'code':
        return add('code', node, start, end, end, () => textOf(node, source))
      case 'table':
        return add('table', node, start, end, end, () => textOf(node, source))
      case 'blockquote':
        return add('quote', node, start, end, end, () => textOf(node, source))
      case 'footnoteDefinition':
        return add('footnote', node, start, end, end, () => textOf(node, source))
      case 'html':
        return add('html', node, start, end, end, empty)
      case 'thematicBreak':
        return add('thematic-break', node, start, end, end, empty)
      case 'yaml':
        return add('front-matter', node, start, end, end, empty)
      case 'definition':
        return add('definition', node, start, end, end, empty)
      case 'list':
        for (const item of node.children) {
          const firstList = item.children.findIndex((child) => child.type === 'list')
          const lastOwn = item.children.findLastIndex((child) => child.type !== 'list')
          if (firstList >= 0 && lastOwn > firstList) {
            // content after a nested list: the whole item is one unit, so units never overlap
            const s = item.position!.start.offset!
            const e = item.position!.end.offset!
            add('list-item', item, s, e, e, () => joinBlocks(item.children, source))
            continue
          }
          const own = item.children.filter((child) => child.type !== 'list')
          const ownEnd =
            own.length > 0 ? own[own.length - 1]!.position!.end.offset! : lineEnd(source, item.position!.start.offset!)
          add('list-item', item, item.position!.start.offset!, ownEnd, item.position!.end.offset!, () =>
            joinBlocks(own, source),
          )
          for (const child of item.children) {
            if (child.type === 'list') {
              visit(child)
            }
          }
        }
        return
      default:
        return add('html', node as Nodes, start, end, end, empty)
    }
  }
  for (const node of tree.children) {
    visit(node)
  }

  const plain: PlainText = { text: chars.join(''), source: offsets, unit: owners }
  return { source, units, sections: sectionsOf(units), plain }
}

function sectionsOf(units: Unit[]): Section[] {
  const sections: Section[] = []
  const open: number[] = []
  units.forEach((unit, index) => {
    if (unit.kind !== 'heading') {
      return
    }
    while (open.length > 0 && sections[open[open.length - 1]!]!.level >= unit.level) {
      open.pop()
    }
    sections.push({ heading: index, level: unit.level, parent: open.at(-1) ?? null, bodyLast: index, last: index })
    open.push(sections.length - 1)
  })
  // a section's own body runs to the next heading of any level; the section to the next of the same or higher level
  sections.forEach((section, i) => {
    let next = units.length
    for (let u = section.heading + 1; u < units.length; u++) {
      if (units[u]!.kind === 'heading') {
        next = u
        break
      }
    }
    section.bodyLast = next - 1
    let end = units.length
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j]!.level <= section.level) {
        end = sections[j]!.heading
        break
      }
    }
    section.last = end - 1
  })
  return sections
}

// --- text extraction ---------------------------------------------------------

/** Characters with the source offset of each. */
type Raw = { chars: string[]; source: number[] }

const empty = (): Raw => ({ chars: [], source: [] })

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'list',
  'listItem',
  'blockquote',
  'table',
  'tableRow',
  'tableCell',
  'code',
  'footnoteDefinition',
  'html',
])

function textOf(node: Nodes, source: string): Raw {
  const out = empty()
  collect(node, source, out)
  return out
}

function joinBlocks(nodes: Nodes[], source: string): Raw {
  const out = empty()
  let previousEnd = -1
  for (const node of nodes) {
    if (out.chars.length > 0) {
      out.chars.push(' ')
      out.source.push(previousEnd)
    }
    collect(node, source, out)
    previousEnd = node.position!.end.offset!
  }
  return out
}

function collect(node: Nodes, source: string, out: Raw): void {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      align(node.value, source, node.position!.start.offset!, node.position!.end.offset!, out)
      return
    case 'code': {
      const start = node.position!.start.offset!
      const end = node.position!.end.offset!
      const fenced = /^[ \t]*(```|~~~)/.test(source.slice(start, start + 8))
      align(node.value, source, fenced ? lineEnd(source, start) + 1 : start, end, out)
      return
    }
    case 'break':
      out.chars.push(' ')
      out.source.push(node.position!.start.offset!)
      return
    case 'html':
    case 'image':
    case 'imageReference':
    case 'definition':
    case 'footnoteReference':
    case 'yaml':
      return
  }
  if (!('children' in node)) {
    return
  }
  const parent = node as Parents
  let previousWasBlock = false
  let previousEnd = node.position!.start.offset!
  for (const child of parent.children) {
    const isBlock = BLOCK_TYPES.has(child.type)
    if ((isBlock || previousWasBlock) && out.chars.length > 0) {
      // the space stands for the gap between blocks, so it maps to the end of the one before
      out.chars.push(' ')
      out.source.push(previousEnd)
    }
    collect(child as Nodes, source, out)
    previousWasBlock = isBlock
    previousEnd = child.position!.end.offset!
  }
}

const ENTITY = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/

/**
 * Lines a node's text value up with its source, which can differ: escapes
 * (`\*` is `*`), entities (`&amp;` is `&`), and indentation or quote markers
 * removed from continuation lines.
 */
function align(value: string, source: string, from: number, to: number, out: Raw): void {
  let j = from
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    if (source[j] === ch) {
      out.chars.push(ch)
      out.source.push(j++)
      continue
    }
    if (source[j] === '\\' && source[j + 1] === ch) {
      out.chars.push(ch)
      out.source.push(j)
      j += 2
      continue
    }
    const entity = source[j] === '&' ? ENTITY.exec(source.slice(j, j + 40)) : null
    if (entity) {
      // an entity can decode to more than one UTF-16 unit; they all map to the entity
      const decodedLength = decodedEntityLength(entity[0])
      for (let k = 0; k < decodedLength && i + k < value.length; k++) {
        out.chars.push(value[i + k]!)
        out.source.push(j)
      }
      i += decodedLength - 1
      j += entity[0].length
      continue
    }
    // skipped syntax (indentation, `>` markers, backticks): find the character nearby
    let k = j
    while (k < to && k - j < 16 && source[k] !== ch) {
      k++
    }
    if (k < to && source[k] === ch) {
      j = k
    }
    out.chars.push(ch)
    out.source.push(Math.min(j, Math.max(from, to - 1)))
    if (source[j] === ch) {
      j++
    }
  }
}

function decodedEntityLength(entity: string): number {
  const numeric = /^&#[xX]?([0-9a-fA-F]+);$/.exec(entity)
  if (numeric) {
    const code = Number.parseInt(numeric[1]!, entity[2] === 'x' || entity[2] === 'X' ? 16 : 10)
    return code > 0xffff ? 2 : 1
  }
  return 1
}

/** Collapses each run of whitespace to one space and trims the ends. */
function collapse(raw: Raw): { text: string; source: number[] } {
  let text = ''
  const source: number[] = []
  let pendingSpace = -1
  for (let i = 0; i < raw.chars.length; i++) {
    const ch = raw.chars[i]!
    if (/\s/.test(ch)) {
      if (pendingSpace < 0) {
        pendingSpace = raw.source[i]!
      }
      continue
    }
    if (pendingSpace >= 0 && text.length > 0) {
      text += ' '
      source.push(pendingSpace)
    }
    pendingSpace = -1
    text += ch
    source.push(raw.source[i]!)
  }
  return { text, source }
}

// --- helpers used by the commands -------------------------------------------

export function lineEnd(source: string, offset: number): number {
  const i = source.indexOf('\n', offset)
  return i < 0 ? source.length : i
}

/** The start of the line if only spaces or tabs come before `offset` on it; otherwise `offset`. */
export function lineStartIfBlank(source: string, offset: number): number {
  let i = offset
  while (i > 0 && (source[i - 1] === ' ' || source[i - 1] === '\t')) {
    i--
  }
  return i === 0 || source[i - 1] === '\n' ? i : offset
}

/** The plain-text index of the first character at or after a source offset. */
export function plainIndexAtOrAfter(plain: PlainText, offset: number): number {
  let lo = 0
  let hi = plain.source.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (plain.source[mid]! < offset) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/** The plain-text index whose character is at exactly this source offset, or -1. */
export function plainIndexAt(plain: PlainText, offset: number): number {
  const i = plainIndexAtOrAfter(plain, offset)
  return i < plain.source.length && plain.source[i] === offset ? i : -1
}

/** The unit whose own content contains this source offset, or -1. */
export function unitAt(units: Unit[], offset: number): number {
  let lo = 0
  let hi = units.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const unit = units[mid]!
    if (offset < unit.start) {
      hi = mid - 1
    } else if (offset >= unit.end) {
      lo = mid + 1
    } else {
      return mid
    }
  }
  return -1
}

/** The innermost section containing a unit, or -1 before the first heading. */
export function sectionOfUnit(parsed: ParsedFile, unit: number): number {
  let found = -1
  parsed.sections.forEach((section, i) => {
    if (section.heading <= unit && unit <= section.last) {
      found = i
    }
  })
  return found
}
