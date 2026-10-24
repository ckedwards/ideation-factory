// PROTOTYPE: shared helpers (markdown, anchoring, diffs, labels).
import { Marked, type Tokens } from 'marked'
import { diffArrays, diffWords } from 'diff'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { NOW, users, type Actor, type Comment } from './data'

// ---------- search params ----------

export type IdeaSearch = { file: string; v?: number; compare?: string; view?: 'feed' }

export const DEFAULT_FILE = 'docs/offline-sync/README.md'

export function parseSearch(s: Record<string, unknown>): IdeaSearch {
  return {
    file: typeof s.file === 'string' ? s.file : DEFAULT_FILE,
    v: typeof s.v === 'number' ? s.v : undefined,
    compare: typeof s.compare === 'string' || typeof s.compare === 'number' ? String(s.compare) : undefined,
    view: s.view === 'feed' ? 'feed' : undefined,
  }
}

export function useIdeaSearch() {
  const search = parseSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const navigate = useNavigate()
  const set = (patch: Partial<IdeaSearch>) =>
    navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }), replace: true } as never)
  return [search, set] as const
}

// ---------- labels ----------

export function userName(id: string) {
  return users[id]?.name ?? id
}

export function ago(iso: string) {
  const mins = Math.round((NOW - Date.parse(iso)) / 60000)
  if (mins <= 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function basename(path: string) {
  return path.split('/').pop() ?? path
}

export function dirname(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

// ---------- markdown ----------

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function resolvePath(fromFile: string, href: string) {
  const parts = dirname(fromFile).split('/').filter(Boolean)
  for (const seg of href.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

export function renderMarkdown(src: string, file: string, files: string[]) {
  const m = new Marked({ gfm: true })
  m.use({
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Heading) {
        const inner = this.parser.parseInline(t.tokens)
        return `<h${t.depth} data-section="${esc(t.text)}">${inner}</h${t.depth}>\n`
      },
      code(t: Tokens.Code) {
        if (t.lang === 'mermaid')
          return `<figure class="md-mermaid"><figcaption>Mermaid diagram · source shown, rendering not prototyped</figcaption><pre><code>${esc(t.text)}</code></pre></figure>\n`
        return `<pre><code>${esc(t.text)}</code></pre>\n`
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Link) {
        const inner = this.parser.parseInline(t.tokens)
        if (/^https?:/.test(t.href))
          return `<a href="${esc(t.href)}" target="_blank" rel="noreferrer" class="md-ext">${inner}</a>`
        const target = resolvePath(file, t.href)
        if (files.includes(target)) return `<a href="#" data-file="${esc(target)}" class="md-internal">${inner}</a>`
        return `<a class="md-missing" title="Not part of this idea">${inner}</a>`
      },
    },
  })
  return m.parse(src, { async: false }) as string
}

export function htmlText(html: string) {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
}

export function headings(src: string) {
  return splitSections(src)
    .map((s) => s.title)
    .filter((t): t is string => t !== null)
}

// ---------- anchoring ----------

export type Placement = 'anchored' | 'lost' | 'file'

export function placeComment(c: Comment, src: string | undefined, text: string, heads: string[]): Placement {
  if (src === undefined) return 'lost'
  if (c.anchor.type === 'file') return 'file'
  if (c.anchor.type === 'section') return heads.includes(c.anchor.section) ? 'anchored' : 'lost'
  return text.includes(c.anchor.quote) ? 'anchored' : 'lost'
}

// Wrap the first occurrence of `quote` (which may span text nodes) in <mark>s.
export function wrapQuote(root: HTMLElement, quote: string, id: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  while (walker.nextNode()) {
    const n = walker.currentNode as Text
    starts.push(text.length)
    nodes.push(n)
    text += n.data
  }
  const idx = text.indexOf(quote)
  if (idx < 0) return false
  const end = idx + quote.length
  for (let i = nodes.length - 1; i >= 0; i--) {
    const s = starts[i]
    const e = s + nodes[i].data.length
    if (e <= idx || s >= end) continue
    let node = nodes[i]
    const from = Math.max(idx, s) - s
    const to = Math.min(end, e) - s
    if (to < node.data.length) node.splitText(to)
    if (from > 0) node = node.splitText(from)
    const mark = document.createElement('mark')
    mark.className = 'anchor'
    mark.dataset.commentId = id
    node.parentNode!.insertBefore(mark, node)
    mark.appendChild(node)
  }
  return true
}

// Nearest heading at or before `node` inside `root`. Works whether or not
// sections have been wrapped in .sec-box elements (see wrapSections).
export function sectionOf(node: Node, root: HTMLElement): string | undefined {
  let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement
  while (el && el !== root) {
    for (let sib: Element | null = el; sib; sib = sib.previousElementSibling)
      if (sib instanceof HTMLElement && sib.dataset.section) return sib.dataset.section
    if (el instanceof HTMLElement && el.classList.contains('sec-box')) return el.dataset.sec
    el = el.parentElement
  }
  return undefined
}

// ---------- sections & diffs ----------

type Section = { title: string | null; level: number; body: string }

export function splitSections(src: string): Section[] {
  const out: Section[] = [{ title: null, level: 0, body: '' }]
  let fence = false
  for (const line of src.split('\n')) {
    if (line.startsWith('```')) fence = !fence
    const m = !fence && /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) out.push({ title: m[2].trim(), level: m[1].length, body: '' })
    else out[out.length - 1].body += line + '\n'
  }
  return out
}

// Section titles whose body differs from `base` (or which are new).
export function changedSections(base: string | undefined, cur: string) {
  const changed = new Set<string>()
  const old = new Map<string, string>()
  if (base !== undefined) for (const s of splitSections(base)) if (s.title) old.set(s.title, s.body.trim())
  for (const s of splitSections(cur)) {
    if (!s.title) continue
    if (old.get(s.title) !== s.body.trim()) changed.add(s.title)
  }
  return changed
}

export type FileChange = 'added' | 'modified' | 'unchanged' | 'removed'

export function fileChange(base: string | undefined, cur: string | undefined): FileChange {
  if (base === undefined && cur !== undefined) return 'added'
  if (cur === undefined) return 'removed'
  return base === cur ? 'unchanged' : 'modified'
}

function blocks(src: string) {
  const out: string[] = []
  let cur: string[] = []
  let fence = false
  for (const l of src.split('\n')) {
    if (l.startsWith('```')) fence = !fence
    if (!fence && l.trim() === '') {
      if (cur.length) out.push(cur.join('\n'))
      cur = []
    } else cur.push(l)
  }
  if (cur.length) out.push(cur.join('\n'))
  return out
}

const PREFIX = /^(\s*(?:[-*+]|\d+\.)\s+|#{1,6}\s+|>\s*)?/

// Inline word diff, or null when the lines are too different to read well
// as one edited line (then they show as a removed + added block instead).
function wordDiffLine(a: string, b: string) {
  const pa = PREFIX.exec(a)![0]
  const pb = PREFIX.exec(b)![0]
  if (pa !== pb) return null
  const parts = diffWords(a.slice(pa.length), b.slice(pb.length))
  const common = parts.filter((p) => !p.added && !p.removed).reduce((n, p) => n + p.value.trim().length, 0)
  if (common / Math.max(a.length - pa.length, b.length - pb.length, 1) < 0.45) return null
  return pb + parts.map((p) => (p.added ? `<ins>${p.value}</ins>` : p.removed ? `<del>${p.value}</del>` : p.value)).join('')
}

function mergeBlock(a: string, b: string) {
  if (a.startsWith('```') || b.startsWith('```') || a.startsWith('|') || b.startsWith('|')) return null
  const out: string[] = []
  const changes = diffArrays(a.split('\n'), b.split('\n'))
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    const n = changes[i + 1]
    if (c.removed && n?.added) {
      const len = Math.max(c.value.length, n.value.length)
      for (let j = 0; j < len; j++) {
        const x = c.value[j]
        const y = n.value[j]
        if (x !== undefined && y !== undefined) {
          const merged = wordDiffLine(x, y)
          if (merged === null) return null
          out.push(merged)
        } else if (y !== undefined) out.push(`${PREFIX.exec(y)![0]}<ins>${y.slice(PREFIX.exec(y)![0].length)}</ins>`)
        else if (x !== undefined) out.push(`${PREFIX.exec(x)![0]}<del>${x.slice(PREFIX.exec(x)![0].length)}</del>`)
      }
      i++
    } else if (c.added || c.removed) {
      const tag = c.added ? 'ins' : 'del'
      for (const l of c.value) out.push(`${PREFIX.exec(l)![0]}<${tag}>${l.slice(PREFIX.exec(l)![0].length)}</${tag}>`)
    } else out.push(...c.value)
  }
  return out.join('\n')
}

// Rendered "redline": unchanged blocks render normally, edits show inline,
// and blocks that moved (identical text, new position) are marked as moved
// rather than shown as a delete plus an insert.
export function renderRedline(base: string, cur: string, file: string, files: string[]) {
  const r = (s: string) => renderMarkdown(s, file, files)
  const changes = diffArrays(blocks(base), blocks(cur))
  const removed = new Set(changes.filter((c) => c.removed).flatMap((c) => c.value))
  const added = new Set(changes.filter((c) => c.added).flatMap((c) => c.value))
  const moved = new Set([...removed].filter((b) => added.has(b)))
  const label = (b: string) => {
    const t = b.split('\n')[0].replace(/^#+\s*|^\s*(?:[-*+]|\d+\.)\s+/g, '').replace(/`|\*\*|__/g, '')
    return t.length > 60 ? t.slice(0, 60) + '…' : t
  }

  const parts: string[] = []
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    if (!c.added && !c.removed) {
      parts.push(...c.value.map(r))
      continue
    }
    // gather a run of removed+added, set the moved blocks aside, pair the rest
    const dels: string[] = []
    const inss: string[] = []
    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      for (const b of changes[i].value) {
        if (changes[i].removed) {
          if (moved.has(b)) parts.push(`<div class="rl-moved-from">Moved: ${label(b)} ↓</div>`)
          else dels.push(b)
        } else if (moved.has(b)) parts.push(`<div class="rl-moved"><span class="rl-moved-tag">Moved</span>${r(b)}</div>`)
        else inss.push(b)
      }
      i++
    }
    i--
    const len = Math.max(dels.length, inss.length)
    for (let j = 0; j < len; j++) {
      const x = dels[j]
      const y = inss[j]
      const merged = x !== undefined && y !== undefined ? mergeBlock(x, y) : null
      if (merged !== null) parts.push(`<div class="rl-edit">${r(merged)}</div>`)
      else {
        if (x !== undefined) parts.push(`<div class="rl-del">${r(x)}</div>`)
        if (y !== undefined) parts.push(`<div class="rl-ins">${r(y)}</div>`)
      }
    }
  }
  return parts.join('\n')
}

// Wrap each heading and everything under it (until a heading of the same or
// higher level) in a <section class="sec-box">, nesting H3 boxes inside H2s.
export function wrapSections(root: HTMLElement) {
  const stack: { level: number; el: HTMLElement }[] = []
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const m = /^H([1-6])$/.exec(el.tagName)
    if (m) {
      const level = Number(m[1])
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      const box = document.createElement('section')
      box.className = 'sec-box'
      box.dataset.sec = el.dataset.section ?? ''
      box.dataset.level = String(level)
      ;(stack.length ? stack[stack.length - 1].el : root).appendChild(box)
      box.appendChild(el)
      stack.push({ level, el: box })
    } else (stack.length ? stack[stack.length - 1].el : root).appendChild(el)
  }
}
