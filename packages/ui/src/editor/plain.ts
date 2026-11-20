// The toolbar on the Markdown side of the switch: each button types the Markdown for what it does,
// as GitHub's box does. Bold wraps the selection in `**`, a list puts `- ` before each of its lines,
// and pressing it again takes them off.
import type { Action } from './milkdown.ts'

/** Replace [start, end) with text, then select [select[0], select[1]). */
export interface PlainEdit {
  start: number
  end: number
  text: string
  select: [number, number]
}

const WRAPS: Partial<Record<Action, string>> = { bold: '**', italic: '_', strike: '~~', code: '`' }
const PREFIXES: Partial<Record<Action, (i: number) => string>> = {
  quote: () => '> ',
  bullets: () => '- ',
  tasks: () => '- [ ] ',
  numbers: (i) => `${i + 1}. `,
}
// what each kind of line starts with, to tell whether a line already has it
const STARTS: Partial<Record<Action, RegExp>> = {
  quote: /^> ?/,
  bullets: /^[-*+] (?!\[[ xX]\] )/,
  tasks: /^[-*+] \[[ xX]\] /,
  numbers: /^\d+[.)] /,
}
// any list marker, so one kind of list can be turned into another
const LIST = /^(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/

export function plainEdit(action: Action, value: string, start: number, end: number): PlainEdit {
  const selected = value.slice(start, end)
  if ((action === 'code' && selected.includes('\n')) || action === 'code-block') {
    return block(value, start, end, '```\n', '\n```')
  }
  const wrap = WRAPS[action]
  if (wrap) {
    const m = wrap.length
    // already wrapped: unwrap
    if (value.slice(start - m, start) === wrap && value.slice(end, end + m) === wrap) {
      return { start: start - m, end: end + m, text: selected, select: [start - m, end - m] }
    }
    if (selected.length > 2 * m && selected.startsWith(wrap) && selected.endsWith(wrap)) {
      const inner = selected.slice(m, -m)
      return { start, end, text: inner, select: [start, start + inner.length] }
    }
    return { start, end, text: wrap + selected + wrap, select: [start + m, end + m] }
  }
  const prefix = PREFIXES[action]
  const has = STARTS[action]
  if (!prefix || !has) {
    return { start, end, text: selected, select: [start, end] }
  }
  // whole lines: from the start of the first to the end of the last
  const from = value.lastIndexOf('\n', start - 1) + 1
  // a selection ending at a line's start doesn't take that line in
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end
  const stop = value.indexOf('\n', last)
  const to = stop === -1 ? value.length : stop
  const lines = value.slice(from, to).split('\n')
  const on = lines.filter((l) => l.trim()).every((l) => has.test(l))
  let n = 0
  const changed = lines.map((line) => {
    if (!line.trim()) {
      return line
    }
    if (on) {
      return line.replace(has, '')
    }
    const bare = action === 'bullets' || action === 'numbers' || action === 'tasks' ? line.replace(LIST, '') : line
    return prefix(n++) + bare
  })
  const text = changed.join('\n')
  // a caret goes to the end of its line; a selection covers the changed lines
  const select: [number, number] = start === end ? [from + text.length, from + text.length] : [from, from + text.length]
  return { start: from, end: to, text, select }
}

/** The selection's lines made headings of this level (their `#`s), or plain lines with 0. */
export function plainHeading(value: string, start: number, end: number, level: number): PlainEdit {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end
  const stop = value.indexOf('\n', last)
  const to = stop === -1 ? value.length : stop
  const text = value
    .slice(from, to)
    .split('\n')
    .map((line) => {
      const bare = line.replace(/^#{1,6}\s+/, '')
      return level === 0 || !bare.trim() ? bare : `${'#'.repeat(level)} ${bare}`
    })
    .join('\n')
  const select: [number, number] = start === end ? [from + text.length, from + text.length] : [from, from + text.length]
  return { start: from, end: to, text, select }
}

/** A link in place of the selection: `[text](address)`, its text the address when there's none. */
export function plainLink(value: string, start: number, end: number, text: string, href: string): PlainEdit {
  const words = (text.trim() || href).replace(/[[\]\\]/g, (c) => `\\${c}`)
  // an address with spaces or brackets in it goes in angle brackets
  const address = /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href
  const link = `[${words}](${address})`
  return { start, end, text: link, select: [start + link.length, start + link.length] }
}

/** A table of this size in place of the selection, on lines of its own, its first heading selected. Rows count the header. */
export function plainTable(value: string, start: number, end: number, columns: number, rows: number): PlainEdit {
  const head = value.slice(0, start)
  const before = start === 0 || head.endsWith('\n\n') ? '' : head.endsWith('\n') ? '\n' : '\n\n'
  const after = value.slice(end).startsWith('\n') || end === value.length ? '\n' : '\n\n'
  const line = (cell: string) => `| ${Array.from({ length: columns }, () => cell).join(' | ')} |`
  const table = [line('Column'), line('---'), ...Array.from({ length: rows - 1 }, () => line(''))].join('\n')
  const at = start + before.length + 2
  return { start, end, text: before + table + after, select: [at, at + 'Column'.length] }
}

/** Wraps the selection's lines in an opening and closing line (a code block). */
function block(value: string, start: number, end: number, open: string, close: string): PlainEdit {
  const before = start === 0 || value[start - 1] === '\n' ? '' : '\n'
  const after = end === value.length || value[end] === '\n' ? '' : '\n'
  const inner = value.slice(start, end).replace(/\n$/, '')
  const text = before + open + inner + close + after
  const at = start + before.length + open.length
  return { start, end, text, select: [at, at + inner.length] }
}

/** The toolbar action a key press on the Markdown side asks for, if any. */
export function plainShortcut(event: {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): Action | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return null
  }
  const key = event.key.toLowerCase()
  if (!event.shiftKey) {
    return key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'e' ? 'code' : key === 'k' ? 'link' : null
  }
  switch (event.code) {
    case 'KeyX':
      return 'strike'
    case 'Period':
      return 'quote'
    case 'Digit7':
      return 'numbers'
    case 'Digit8':
      return 'bullets'
  }
  return null
}
