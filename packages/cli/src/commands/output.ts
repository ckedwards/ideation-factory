// Shared human-readable output.
import type { Output, Operations } from '@ideaf/api'
import { plainLine } from '@ideaf/core'

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
          : o.anchor?.kind === 'block'
            ? `block ${o.anchor.block}`
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

/** Some Markdown (a comment, a summary) as it reads, without its syntax, cut short. */
export function excerpt(markdown: string, length: number): string {
  return truncate(plainLine(markdown), length)
}

/** How long ago, roughly: "just now", "5m ago", "3h ago", "2d ago", or the date past a month. */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(at).toISOString().slice(0, 10)
}
