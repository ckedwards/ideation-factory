// Mermaid diagrams, drawn with Pele (github.com/obsidianmd/pele) as SVG.
//
// Most architecture documents have diagrams, so Pele isn't left until a page
// needs it: preloadDiagrams() fetches it (in its own chunk) and the common
// diagram types, and the app calls it at startup. Rarer types load the first
// time they're needed. Drawn diagrams are cached by their source, so drawing
// one again, or re-rendering the page, is instant and never flickers.
import { useEffect, useState } from 'react'
import type { DiagramType } from 'pele/lazy'

type Pele = typeof import('pele/lazy')

/** A drawing, or why there isn't one. */
export type Drawn = { svg: string; type: string } | { error: string }

const COMMON: DiagramType[] = ['flowchart', 'sequence', 'class', 'state', 'er', 'c4', 'architecture']

let ready: Promise<Pele> | undefined

/** Fetch Pele and the common diagram types, once. */
export function preloadDiagrams(): Promise<Pele> {
  ready ??= import('pele/lazy').then(async (pele) => {
    await Promise.all(COMMON.map((type) => pele.load(type).catch(() => false)))
    return pele
  })
  return ready
}

const drawn = new Map<string, Drawn>()
const drawing = new Map<string, Promise<Drawn>>()
let count = 0

/** The finished drawing for this source, if it's been drawn. */
export function drawnDiagram(source: string): Drawn | undefined {
  return drawn.get(source)
}

/** Draw a diagram, or find it in the cache. Never rejects: a failure is { error }. */
export function drawDiagram(source: string): Promise<Drawn> {
  const done = drawn.get(source)
  if (done) {
    return Promise.resolve(done)
  }
  let pending = drawing.get(source)
  if (!pending) {
    pending = preloadDiagrams()
      .then(async (pele): Promise<Drawn> => {
        try {
          const { svg, mermaidType } = await pele.renderAsync(source, {
            responsive: true,
            // diagrams come from people's documents: no links or images out of them
            links: false,
            images: false,
            fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
            // several diagrams on a page mustn't share element IDs
            idPrefix: `diagram-${++count}-`,
          })
          return { svg, type: mermaidType }
        } catch (error) {
          return { error: describe(error, pele) }
        }
      })
      .catch((error: unknown): Drawn => ({ error: `Pele didn’t load: ${String(error)}` }))
      .then((result) => {
        drawn.set(source, result)
        drawing.delete(source)
        return result
      })
    drawing.set(source, pending)
  }
  return pending
}

// "line 3: Expected an arrow": a syntax error spans several lines (with a caret
// under the mistake), and the last one says what's wrong
function describe(error: unknown, pele: Pele): string {
  const line = error instanceof pele.PeleError && error.line ? `line ${error.line}: ` : ''
  const message = error instanceof Error ? error.message : String(error)
  const last = message
    .split('\n')
    .filter((part) => part.trim())
    .at(-1)
  return `${line}${last?.trim() ?? 'unknown error'}`
}

/** The drawing for this source: undefined until it's drawn. */
export function useDiagram(source: string): Drawn | undefined {
  const [result, setResult] = useState(() => drawnDiagram(source))
  useEffect(() => {
    let live = true
    const cached = drawnDiagram(source)
    setResult(cached)
    if (!cached) {
      void drawDiagram(source).then((next) => {
        if (live) {
          setResult(next)
        }
      })
    }
    return () => {
      live = false
    }
  }, [source])
  return result
}
