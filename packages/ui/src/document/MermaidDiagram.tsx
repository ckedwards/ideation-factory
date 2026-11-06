import type { Code } from 'mdast'
import type { ReactNode } from 'react'
import { useDiagram } from './diagrams.ts'
import './MermaidDiagram.css'

export interface MermaidDiagramProps {
  // the Mermaid source, as written in the file
  source: string
}

// A Mermaid diagram, drawn. The text around it is shown at once; until the
// drawing lands, "Drawing diagram…" holds its place. One that can't be drawn
// shows its source and the exact error, so nothing is ever hidden. The source
// is always one click away: it's what's versioned and commented on.
export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const drawn = useDiagram(source)
  if (drawn && 'error' in drawn) {
    return (
      <figure className="diagram is-broken">
        <figcaption>
          <span aria-hidden>⚠ </span>Couldn’t draw this diagram: {drawn.error}
        </figcaption>
        <pre tabIndex={0}>
          <code data-lang="mermaid">{source}</code>
        </pre>
      </figure>
    )
  }
  return (
    <figure className={drawn ? 'diagram' : 'diagram is-pending'}>
      {drawn ? (
        <div
          className="diagram-drawing"
          role="img"
          aria-label={`${drawn.type} diagram`}
          // Pele's SVG, drawn from the source with links and images off
          dangerouslySetInnerHTML={{ __html: drawn.svg }}
        />
      ) : (
        <div className="diagram-drawing diagram-wait" aria-busy="true">
          Drawing diagram…
        </div>
      )}
      <details className="diagram-source">
        <summary>Mermaid source</summary>
        <pre tabIndex={0}>
          <code data-lang="mermaid">{source}</code>
        </pre>
      </details>
    </figure>
  )
}

/** For MarkdownView's renderCode: Mermaid blocks drawn, other code shown as code. */
export function renderMermaid(code: Code): ReactNode | undefined {
  return code.lang === 'mermaid' ? <MermaidDiagram source={code.value} /> : undefined
}
