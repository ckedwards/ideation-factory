// Shared human-readable output.
import type { Output, Operations } from '@ideaf/api'

type Outcome = Output<Operations['edit']>['comments'][number]

export function describeOutcomes(outcomes: Outcome[]): string[] {
  if (outcomes.length === 0) {
    return []
  }
  const counts = new Map<string, number>()
  for (const o of outcomes) {
    counts.set(o.state, (counts.get(o.state) ?? 0) + 1)
  }
  const lines = [`Comments: ${[...counts].map(([state, n]) => `${n} ${state}`).join(', ')}`]
  for (const o of outcomes) {
    if (o.state === 'exact') {
      continue
    }
    const where =
      o.anchor?.kind === 'text'
        ? `"${o.anchor.quote}"`
        : o.anchor?.kind === 'section'
          ? `section ${o.anchor.section}`
          : o.anchor?.kind === 'file'
            ? `file ${o.anchor.file}`
            : o.anchor?.kind === 'idea'
              ? 'the idea'
              : ''
    lines.push(`  ${o.id}  ${o.state}${where ? `, now on ${where}` : ''}`)
  }
  return lines
}

export function truncate(text: string, length: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}
