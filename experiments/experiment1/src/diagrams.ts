// Mermaid diagrams, drawn asynchronously with Pele (github.com/obsidianmd/pele).
//
// Most architecture documents have diagrams, so Pele isn't loaded on demand:
// preloadDiagrams() starts fetching it (in its own chunk) as soon as the app
// starts, along with the diagram types architecture docs use most. Rarer types
// load the first time they're needed.
//
// Markdown renders synchronously. A diagram that's already been drawn comes out
// finished straight away (drawn diagrams are cached by their source, so
// re-renders never redraw or flicker). One that hasn't comes out as a
// "Drawing diagram…" placeholder, and drawPending() swaps in the drawing when
// it's ready. Every state keeps the source in the page; it's what's versioned
// and commented on.
import type { DiagramType } from 'pele/lazy'

type Pele = typeof import('pele/lazy')
type Drawn = { svg: string; type: string } | { error: string }

const COMMON: DiagramType[] = ['flowchart', 'sequence', 'class', 'state', 'er', 'c4', 'architecture']

let ready: Promise<Pele> | undefined
export function preloadDiagrams(): Promise<Pele> {
  ready ??= import('pele/lazy').then(async (pele) => {
    await Promise.all(COMMON.map((t) => pele.load(t).catch(() => false)))
    return pele
  })
  return ready
}

const drawn = new Map<string, Drawn>()
const drawing = new Map<string, Promise<Drawn>>()
let count = 0

function drawDiagram(src: string): Promise<Drawn> {
  const done = drawn.get(src)
  if (done) return Promise.resolve(done)
  let p = drawing.get(src)
  if (!p) {
    p = preloadDiagrams().then(async (pele) => {
      let d: Drawn
      try {
        const { svg, mermaidType } = await pele.renderAsync(src, {
          responsive: true,
          // diagrams come from people's documents: no links or images out of them
          links: false,
          images: false,
          fontFamily: 'Inter, system-ui, sans-serif',
          idPrefix: `d${++count}-`,
        })
        d = { svg, type: mermaidType }
      } catch (e) {
        const where = e instanceof pele.PeleError && e.line ? ` (line ${e.line})` : ''
        // syntax errors span several lines (with a caret pointer); the last says what's wrong
        const why = (e instanceof Error ? e.message : String(e)).split('\n').filter((l) => l.trim()).at(-1) ?? 'unknown error'
        d = { error: `${where}: ${why}` }
      }
      drawn.set(src, d)
      drawing.delete(src)
      return d
    })
    drawing.set(src, p)
  }
  return p
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The figure for a diagram: finished if it's been drawn, otherwise a placeholder.
export function diagramFigure(src: string) {
  const d = drawn.get(src)
  const source = `<details class="md-mermaid-src"><summary>Mermaid source</summary><pre><code>${esc(src)}</code></pre></details>`
  if (!d)
    return `<figure class="md-mermaid is-pending"><div class="md-mermaid-svg md-mermaid-wait" aria-busy="true">Drawing diagram…</div>${source}</figure>`
  if ('error' in d)
    return `<figure class="md-mermaid is-broken"><figcaption>Couldn’t draw this diagram${esc(d.error)}</figcaption><pre><code>${esc(src)}</code></pre></figure>`
  return `<figure class="md-mermaid"><div class="md-mermaid-svg" role="img" aria-label="${esc(d.type)} diagram">${d.svg}</div>${source}</figure>`
}

// Draw every placeholder in `root`, replacing each one as its drawing is ready.
export function drawPending(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.md-mermaid.is-pending').forEach((fig) => {
    const src = fig.querySelector('code')?.textContent ?? ''
    drawDiagram(src).then(() => {
      if (fig.isConnected) fig.outerHTML = diagramFigure(src)
    })
  })
}
