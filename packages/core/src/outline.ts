// The structured view of an idea: each file's sections and blocks, with their
// stable IDs and source text, which is what `ideaf show --blocks`, the MCP tool
// and the web editor read before building a batch.
import type { Idea } from './idea.ts'
import { parseMarkdown, sectionOfUnit, type UnitKind } from './markdown.ts'

export interface OutlineEntry {
  id: string
  kind: UnitKind
  /** The heading path of the section it's in, outermost first (for a heading, its own path). */
  path: string[]
  /** The innermost section it belongs to (for a heading, the enclosing one), or null before the first heading. */
  section: string | null
  /** Heading level, for headings. */
  level?: number
  /** The unit's source text. For a heading, this is its heading line. */
  source: string
}

export interface FileOutline {
  id: string
  path: string
  entries: OutlineEntry[]
}

export function outline(idea: Idea): FileOutline[] {
  return idea.files.map((file) => {
    const parsed = parseMarkdown(file.source)
    const titles = parsed.units.map((u) => parsed.plain.text.slice(u.plainStart, u.plainEnd))
    const pathOf = (section: number): string[] => {
      const out: string[] = []
      for (let s: number | null = section; s !== null && s >= 0; s = parsed.sections[s]!.parent) {
        out.unshift(titles[parsed.sections[s]!.heading]!)
      }
      return out
    }
    const entries = parsed.units.map((unit, i): OutlineEntry => {
      const own = sectionOfUnit(parsed, i)
      const enclosing = unit.kind === 'heading' ? (parsed.sections[own]?.parent ?? -1) : own
      return {
        id: file.unitIds[i]!,
        kind: unit.kind,
        path: own >= 0 ? pathOf(own) : [],
        section: enclosing >= 0 ? file.unitIds[parsed.sections[enclosing]!.heading]! : null,
        ...(unit.kind === 'heading' ? { level: unit.level } : {}),
        source: file.source.slice(unit.start, unit.end),
      }
    })
    return { id: file.id, path: file.path, entries }
  })
}
