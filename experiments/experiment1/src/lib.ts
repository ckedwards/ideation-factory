// PROTOTYPE: shared helpers (markdown, anchoring, diffs, labels).
import { Marked, type Tokens } from 'marked'
import { diffArrays, diffWords } from 'diff'
import { diagramFigure } from './diagrams'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { NOW, defaultFile, idea, users, type Actor, type Comment, type ExternalImages, type Media } from './data'

// ---------- search params ----------

// `idea` picks which canned idea the page shows (see selectIdea in data.ts)
export type IdeaSearch = { idea?: string; file: string; v?: number; compare?: string; view?: 'feed' }

export function parseSearch(s: Record<string, unknown>): IdeaSearch {
  return {
    idea: typeof s.idea === 'string' ? s.idea : undefined,
    file: typeof s.file === 'string' ? s.file : defaultFile,
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

// Where a repo file lives on the code host, at the idea's branch.
export function sourceUrl(path: string) {
  return `https://github.com/${idea.repo}/blob/${idea.branch}/${path}`
}

function fmtBytes(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${Math.round(n / 1000)} KB` : `${n} B`
}

const KIND_BY_EXT: Record<string, string> = { pdf: 'PDF', mp4: 'Video', mov: 'Video', webm: 'Video', zip: 'Archive', csv: 'CSV', xlsx: 'Spreadsheet', ts: 'Code', tsx: 'Code', go: 'Code', py: 'Code', md: 'Markdown' }

// media: images uploaded with this version (see data.ts). Images render from the
// upload; anything else relative resolves to the repository on the code host.
// externalImages: the deployment's setting for images hosted on other sites.
export function renderMarkdown(src: string, file: string, files: string[], media: Record<string, Media> = {}, externalImages: ExternalImages = 'click') {
  const m = new Marked({ gfm: true })
  m.use({
    renderer: {
      image(t: Tokens.Image) {
        const alt = esc(t.text || 'Image')
        if (/^https?:/.test(t.href)) {
          const host = new URL(t.href).host
          if (externalImages === 'always')
            return `<span class="md-image md-image-external"><img src="${esc(t.href)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" /><span class="md-image-cap">${alt} · from ${esc(host)}</span></span>`
          if (externalImages === 'never')
            return `<span class="md-media md-media-external"><span class="md-media-icon" aria-hidden="true">🖼</span><span class="md-media-text"><b>${alt}</b> · external image from ${esc(host)}. This deployment doesn’t load images from other sites.</span><a class="md-ext" href="${esc(t.href)}" target="_blank" rel="noreferrer">Open link</a></span>`
          return `<span class="md-media md-media-external"><span class="md-media-icon" aria-hidden="true">🖼</span><span class="md-media-text"><b>${alt}</b> · external image from ${esc(host)}. Not loaded automatically, so outside sites can’t track who reads this.</span><button type="button" class="md-media-show" data-show-image="${esc(t.href)}" data-alt="${alt}">Show image</button></span>`
        }
        const path = resolvePath(file, t.href)
        const found = media[path]
        if (found?.status === 'uploaded')
          return `<span class="md-image"><img src="${esc(found.url)}" alt="${alt}" loading="lazy" /><span class="md-image-cap">${alt} · ${esc(basename(path))} · ${fmtBytes(found.bytes)}</span></span>`
        const why = found?.status === 'skipped' ? found.reason : 'Not uploaded with this version'
        return `<span class="md-media md-media-missing"><span class="md-media-icon" aria-hidden="true">🖼</span><span class="md-media-text"><b>${alt}</b> · ${esc(basename(path))}. ${esc(why)}.</span><a class="md-ext" href="${esc(sourceUrl(path))}" target="_blank" rel="noreferrer">View on GitHub</a></span>`
      },
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Heading) {
        const inner = this.parser.parseInline(t.tokens)
        return `<h${t.depth} data-section="${esc(t.text)}">${inner}</h${t.depth}>\n`
      },
      code(t: Tokens.Code) {
        if (t.lang === 'mermaid') return `${diagramFigure(t.text)}\n`
        return `<pre><code>${esc(t.text)}</code></pre>\n`
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Link) {
        const inner = this.parser.parseInline(t.tokens)
        if (/^https?:/.test(t.href))
          return `<a href="${esc(t.href)}" target="_blank" rel="noreferrer" class="md-ext">${inner}</a>`
        // a link to another file of the idea (possibly to a heading in it) opens that file
        const target = resolvePath(file, t.href.split('#')[0])
        if (files.includes(target)) return `<a href="#" data-file="${esc(target)}" class="md-internal">${inner}</a>`
        // not part of the idea (PDFs, video, code, other docs): open it in the repository
        const ext = target.split('.').pop()?.toLowerCase() ?? ''
        const kind = KIND_BY_EXT[ext]
        return `<a href="${esc(sourceUrl(target))}" target="_blank" rel="noreferrer" class="md-ext md-source" title="Not in this idea. Opens ${esc(target)} on GitHub.">${inner}</a>${kind ? `<span class="md-filetype">${kind} · GitHub</span>` : ''}`
      },
    },
  })
  return m.parse(src, { async: false }) as string
}

// Plain text of rendered HTML, for matching comment quotes. For diagrams only
// their source counts (not the drawing, its labels, captions or the
// placeholder), so the text is the same whether a diagram is drawn yet or not,
// and labels inside a drawing never produce a second match.
export function htmlText(html: string) {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  body.querySelectorAll('.md-mermaid-svg, .md-mermaid figcaption, .md-mermaid summary, svg').forEach((n) => n.remove())
  return body.textContent ?? ''
}


export function headings(src: string) {
  return splitSections(src)
    .map((s) => s.title)
    .filter((t): t is string => t !== null)
}

// ---------- anchoring ----------

// 'outdated': the text (or section) it was on isn't in this version. There's no
// re-attaching: it links to the last version where its text was.
export type Placement = 'anchored' | 'outdated' | 'file'

export function placeComment(c: Comment, src: string | undefined, text: string, heads: string[]): Placement {
  if (src === undefined) return 'outdated'
  if (c.anchor.type === 'file') return 'file'
  if (c.anchor.type === 'section') return heads.includes(c.anchor.section) ? 'anchored' : 'outdated'
  return text.includes(c.anchor.quote) ? 'anchored' : 'outdated'
}

// The newest version (at or before `upTo`) where an outdated comment's text or
// section still exists, so readers can see what it was about.
export function lastSeenIn(c: Comment, versions: { n: number; files: Record<string, string> }[], upTo: number): number | undefined {
  for (const v of [...versions].sort((a, b) => b.n - a.n)) {
    if (v.n > upTo) continue
    if (v.n < c.version) break
    const s = v.files[c.file]
    if (s === undefined) continue
    if (placeComment(c, s, htmlText(renderMarkdown(s, c.file, Object.keys(v.files))), headings(s)) === 'anchored') return v.n
  }
  return undefined
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
// Images referenced by a block of markdown, as repo paths.
function imagesIn(block: string, file: string) {
  return [...block.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((h) => !/^https?:/.test(h)).map((h) => resolvePath(file, h))
}
const hashOf = (m: Media | undefined) => (m?.status === 'uploaded' ? m.hash : m ? `skipped:${m.reason}` : '')

export function renderRedline(
  base: string,
  cur: string,
  file: string,
  files: string[],
  baseMedia: Record<string, Media> = {},
  curMedia: Record<string, Media> = {},
  externalImages: ExternalImages = 'click',
) {
  const r = (s: string) => renderMarkdown(s, file, files, curMedia, externalImages)
  const rOld = (s: string) => renderMarkdown(s, file, files, baseMedia, externalImages)
  // the same markdown line can point at an image whose contents changed
  const imageChange = (b: string) => {
    const changed = imagesIn(b, file).filter((p) => hashOf(baseMedia[p]) !== hashOf(curMedia[p]))
    if (!changed.length) return null
    return `<div class="rl-edit rl-image"><span class="rl-image-label">Image changed</span><div class="rl-image-pair"><div class="rl-image-before">${rOld(b)}</div><div class="rl-image-after">${r(b)}</div></div></div>`
  }
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
      parts.push(...c.value.map((b) => imageChange(b) ?? r(b)))
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
        if (x !== undefined) parts.push(`<div class="rl-del">${rOld(x)}</div>`)
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
