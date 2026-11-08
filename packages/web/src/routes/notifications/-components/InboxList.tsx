// The inbox as a list: one row per idea, however much happened, like
// GitHub's notifications. Each row says what the idea is, the latest update
// (and how many are new), why you hear about it, where the idea stands now,
// and when. Ticking rows acts on them; with none ticked, the toolbar acts on
// the whole list.
import { type ReactNode, useState } from 'react'
import { type Actor, ActorLabel, Button, Empty, Link, RelativeTime, StatusPill } from '@ideaf/ui'
import type { ShownStatus } from '../../../ideas.ts'
import './InboxList.css'

export interface InboxRowView {
  id: string
  title: string
  href: string
  /** Its team, or whose own idea it is. */
  where: string
  status: ShownStatus
  /** Why you hear about it, in words. */
  reason: string
  /** The latest update: who, and what they did. */
  actor: Actor | null
  update: ReactNode
  newCount: number
  at: number
}

export interface InboxListProps {
  rows: InboxRowView[]
  /** The inbox, or the ideas marked done. */
  showing: 'inbox' | 'done'
  /** Each takes the ideas ticked, or null for the whole list. */
  onRead: (ids: string[] | null) => void
  onDone: (ids: string[] | null) => void
  onBack: (ids: string[] | null) => void
  empty: ReactNode
  more?: { loading: boolean; onMore: () => void } | null
}

export function InboxList({ rows, showing, onRead, onDone, onBack, empty, more }: InboxListProps) {
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  // only ticked rows still in the list count
  const chosen = rows.filter((r) => ticked.has(r.id)).map((r) => r.id)
  const n = chosen.length
  const act = (fn: (ids: string[] | null) => void) => {
    fn(n > 0 ? chosen : null)
    setTicked(new Set())
  }
  const tick = (id: string, on: boolean) =>
    setTicked((now) => {
      const next = new Set(now)
      if (on) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  if (rows.length === 0) {
    return <Empty>{empty}</Empty>
  }
  return (
    <div className="inbox">
      <div className="inbox-toolbar" role="toolbar" aria-label="Notifications">
        <input
          type="checkbox"
          aria-label="Select all"
          checked={n > 0 && n === rows.length}
          ref={(box) => {
            if (box) {
              box.indeterminate = n > 0 && n < rows.length
            }
          }}
          onChange={(event) => setTicked(event.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
        />
        {showing === 'inbox' ? (
          <>
            <Button size="sm" onClick={() => act(onRead)}>
              {n > 0 ? `Mark ${n} as read` : 'Mark all as read'}
            </Button>
            <Button size="sm" onClick={() => act(onDone)}>
              {n > 0 ? `Mark ${n} as done` : 'Mark all as done'}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => act(onBack)}>
            {n > 0 ? `Move ${n} back to the inbox` : 'Move all back to the inbox'}
          </Button>
        )}
        {n > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
            Clear selection
          </Button>
        )}
      </div>
      <ul className="inbox-rows">
        {rows.map((row) => (
          <li key={row.id} className={row.newCount > 0 ? 'inbox-row is-unread' : 'inbox-row'}>
            <input
              type="checkbox"
              aria-label={`Select ${row.title}`}
              checked={ticked.has(row.id)}
              onChange={(event) => tick(row.id, event.target.checked)}
            />
            <div className="inbox-main">
              <div className="inbox-title">
                <span className="inbox-where">{row.where}</span>
                <Link href={row.href}>{row.title}</Link>
              </div>
              <div className="inbox-update">
                {row.actor && <ActorLabel actor={row.actor} short />} {row.update}
                {row.newCount > 1 && <span className="inbox-new"> · {row.newCount} new</span>}
              </div>
            </div>
            <StatusPill status={row.status.status} {...(row.status.reason ? { reason: row.status.reason } : {})} />
            <span className="inbox-reason">{row.reason}</span>
            <span className="inbox-time">
              <RelativeTime at={row.at} />
            </span>
          </li>
        ))}
      </ul>
      {more && (
        <Button onClick={more.onMore} disabled={more.loading}>
          {more.loading ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </div>
  )
}
