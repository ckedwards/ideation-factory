// Writing a table back as Markdown, in the file's own table style. Tables are the block Markdown
// writers restyle most (remark pads every column), so a table someone edited comes back the way the
// file writes its tables: padded into columns only if they are, with the divider row's spacing and
// dashes as the file has them. A table nobody edited is never written at all (see markdown.ts).
import type { Root, Table, TableCell } from 'mdast'

export interface TableStyle {
  /** Every row padded so the pipes line up. */
  padded: boolean
  /** A space inside each pipe in the rows: `| a | b |`, not `|a|b|`. */
  spaced: boolean
  /** The same in the divider row: `| --- |`, not `|---|`. */
  dividerSpaced: boolean
  /** Dashes in a divider cell that's not padded (at least 3). */
  dashes: number
}

const DEFAULT: TableStyle = { padded: false, spaced: true, dividerSpaced: true, dashes: 3 }

/** How the file writes its tables, read from its first one; the default for a file with none. */
export function tableStyle(source: string, tree: Root): TableStyle {
  const table = tree.children.find((n): n is Table => n.type === 'table')
  if (!table?.position) {
    return DEFAULT
  }
  const lines = source.slice(table.position.start.offset, table.position.end.offset).split('\n')
  const cells = (line: string | undefined) =>
    (line ?? '')
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
  const spaced = (line: string | undefined) => cells(line).every((cell) => /^ .* $/.test(cell))
  return {
    padded: lines.length > 2 && lines.every((line) => line.length === lines[0]!.length),
    spaced: spaced(lines[0]),
    dividerSpaced: spaced(lines[1]),
    dashes: Math.max(3, (cells(lines[1])[0]?.match(/-/g) ?? []).length),
  }
}

// remark-stringify's own types aren't a dependency here; this is the part of its state used
interface State {
  enter: (name: string) => () => void
  containerPhrasing: (node: TableCell, info: object) => string
  createTracker: (info: object) => { current: () => object }
}

/** A remark-stringify handler for tables, in the given style. */
export function tableHandler(style: TableStyle) {
  return (node: Table, _parent: unknown, state: State, info: object): string => {
    const exit = state.enter('table')
    const rows = node.children.map((row) =>
      row.children.map((cell) => {
        const done = state.enter('tableCell')
        const text = state.containerPhrasing(cell, { before: '|', after: '|', ...state.createTracker(info).current() })
        done()
        return text
      }),
    )
    exit()
    const columns = rows[0]?.length ?? 0
    const align = Array.from({ length: columns }, (_, i) => node.align?.[i] ?? null)
    const widths = align.map((a, i) =>
      style.padded
        ? Math.max(a === 'center' ? 5 : a ? 4 : 3, ...rows.map((row) => [...(row[i] ?? '')].length))
        : style.dashes,
    )
    const pad = (text: string, i: number) => {
      if (!style.padded) {
        return text
      }
      const gap = widths[i]! - [...text].length
      if (align[i] === 'right') {
        return ' '.repeat(gap) + text
      }
      if (align[i] === 'center') {
        return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2))
      }
      return text + ' '.repeat(gap)
    }
    const line = (cells: string[], spaced = style.spaced) =>
      '|' +
      align
        .map((_, i) => {
          const text = pad(cells[i] ?? '', i)
          return spaced || style.padded ? ` ${text} ` : text || ' '
        })
        .join('|') +
      '|'
    const mark = (a: Table['align'] extends Array<infer A> | null | undefined ? A : never, width: number) => {
      const dashes = '-'.repeat(Math.max(1, width - (a === 'center' ? 2 : a ? 1 : 0)))
      return a === 'center' ? `:${dashes}:` : a === 'left' ? `:${dashes}` : a === 'right' ? `${dashes}:` : dashes
    }
    const divider = line(
      align.map((a, i) => mark(a, widths[i]!)),
      style.dividerSpaced,
    )
    return [line(rows[0] ?? []), divider, ...rows.slice(1).map((row) => line(row))].join('\n')
  }
}
