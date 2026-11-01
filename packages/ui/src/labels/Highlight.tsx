import './Highlight.css'

// Where the query best matches the text, ignoring case: the start of the text
// beats the start of a word, which beats the middle of one.
export function findMatch(query: string, text: string): { start: number; end: number } | null {
  const q = query.trim().toLowerCase()
  if (!q) {
    return null
  }
  const t = text.toLowerCase()
  let best: { start: number; end: number; tier: number } | null = null
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) {
    const tier = i === 0 ? 0 : /[\s\-_/·(“"'@]/.test(t[i - 1] ?? '') ? 1 : 2
    if (!best || tier < best.tier) {
      best = { start: i, end: i + q.length, tier }
    }
    if (tier <= 1) {
      break
    }
  }
  return best && { start: best.start, end: best.end }
}

export interface HighlightProps {
  text: string
  query?: string | undefined
}

// Text with the search match marked.
export function Highlight({ text, query }: HighlightProps) {
  // one span, so a flex or grid parent doesn't split the text into items
  const hit = query ? findMatch(query, text) : null
  if (!hit) {
    return <span>{text}</span>
  }
  return (
    <span>
      {text.slice(0, hit.start)}
      <mark className="highlight">{text.slice(hit.start, hit.end)}</mark>
      {text.slice(hit.end)}
    </span>
  )
}
