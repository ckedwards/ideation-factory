// PROTOTYPE: simple "includes" search with closest-match ranking.
//
// An item matches if the query appears anywhere in one of its fields
// (case-insensitive). Matches are ranked by field first (a title match beats a
// team, author or description match), then by how close the match is:
//   1. the field is exactly the query
//   2. the field starts with the query
//   3. a word in the field starts with the query
//   4. the query is inside a word
// then by how early the match is, then by how little extra text surrounds it.

export type Hit = { start: number; end: number; tier: number }

export function matchText(query: string, text: string): Hit | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const t = text.toLowerCase()
  let best: Hit | null = null
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) {
    const tier = t === q ? 0 : i === 0 ? 1 : /[\s\-_/·(“"']/.test(t[i - 1]) ? 2 : 3
    if (!best || tier < best.tier) best = { start: i, end: i + q.length, tier }
    if (tier <= 2) break
  }
  return best
}

export type Field = { name: string; text: string; weight: number } // weight: 0 = most important

export type Ranked<T> = { item: T; score: number; field: string; hit: Hit }

export function rank<T>(items: T[], query: string, fields: (item: T) => Field[]): Ranked<T>[] {
  const q = query.trim()
  if (!q) return []
  const out: Ranked<T>[] = []
  for (const item of items) {
    let best: Ranked<T> | null = null
    for (const f of fields(item)) {
      const hit = matchText(q, f.text)
      if (!hit) continue
      const score = f.weight * 10_000 + hit.tier * 1_000 + hit.start * 10 + (f.text.length - q.length) * 0.01
      if (!best || score < best.score) best = { item, score, field: f.name, hit }
    }
    if (best) out.push(best)
  }
  return out.sort((a, b) => a.score - b.score)
}
