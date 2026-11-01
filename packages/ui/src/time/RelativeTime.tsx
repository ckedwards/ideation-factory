// Times as "3d ago", with the full date on hover. What "now" is comes from
// NowProvider, so stories and tests show the same text every run; without
// one, it's the clock.
import { createContext, useContext } from 'react'

const NowContext = createContext<(() => number) | null>(null)

export const NowProvider = NowContext.Provider

export function useNow(): number {
  const now = useContext(NowContext)
  return now ? now() : Date.now()
}

export function formatAgo(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes <= 1) {
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
  if (days < 45) {
    return `${days}d ago`
  }
  return new Date(at).toLocaleDateString('en', { month: 'short', year: 'numeric' })
}

export interface RelativeTimeProps {
  // milliseconds since the epoch
  at: number
}

export function RelativeTime({ at }: RelativeTimeProps) {
  const now = useNow()
  const date = new Date(at)
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}>
      {formatAgo(at, now)}
    </time>
  )
}
