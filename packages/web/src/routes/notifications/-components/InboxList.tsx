// The inbox as a list: one row per idea, however much happened, like GitHub's
// notifications, and a row for each notice about a team or a group; grouped by
// day, or by team (a section per team, per person for ideas outside any team,
// and per group for its own notices, each read or done as a whole). Each row
// says what kind of update came last (an icon), what the idea is, the latest
// update (and how many are new), where the idea stands now (a notice has no
// status), why you hear about it (a review asked of you stands out), and when:
// in columns when the list has room for the title, and otherwise on one line
// under it. An unread row has a dot and a bold title. Ticking rows acts on
// them; with none ticked, the toolbar acts on the whole list.
import { type ReactNode, useState } from 'react'
import {
  type Actor,
  ActorLabel,
  Button,
  Empty,
  Icon,
  Link,
  RelativeTime,
  SegmentedControl,
  StatusPill,
  Tag,
} from '@ideaf/ui'
import type { ShownStatus } from '../../../ideas.ts'
import './InboxList.css'

/** A section of the inbox grouped by team: a team's ideas, a person's outside any team, or a group's own notices. */
export type InboxScope = { team: string } | { owner: string } | { group: string }

export interface InboxSection {
  key: string
  /** "Mobile", "Your ideas", "Alex Romero’s ideas", or a group's name. */
  name: string
  scope: InboxScope
  /** A group's own section (its notices), tagged as a group: its name alone doesn't say. */
  group?: boolean
}

export interface InboxRowView {
  id: string
  /** The team it's in, or whose idea outside any team it is: its section, grouped by team. */
  section: InboxSection
  title: string
  /** Where it's seen; null for a notice about a team or group that's gone. */
  href: string | null
  /** Its team, or whose own idea it is (a notice's team, or its group). */
  where: string
  /** Where an idea stands now; a notice has none. */
  status?: ShownStatus
  /** Why you hear about it, in words. */
  reason: string
  /** You're asked to review it: it stands out. */
  asked?: boolean
  /** The kind of the latest update, for its icon; `notice` for a notice about a team or a group. */
  kind?: UpdateKind | 'notice'
  /** The latest update: who, and what they did. */
  actor: Actor | null
  update: ReactNode
  newCount: number
  at: number
}

export type UpdateKind =
  | 'version'
  | 'comment'
  | 'suggestion'
  | 'reply'
  | 'review'
  | 'dismissed'
  | 'status'
  | 'decided'
  | 'requested'

const DAY = 24 * 3600_000

/** Which day group a time is in, from today's start. */
function dayOf(at: number, today: number): string {
  if (at >= today) {
    return 'Today'
  }
  if (at >= today - DAY) {
    return 'Yesterday'
  }
  if (at >= today - 6 * DAY) {
    return 'This week'
  }
  return 'Older'
}

export interface InboxListProps {
  rows: InboxRowView[]
  /** The inbox, or the ideas marked done. */
  showing: 'inbox' | 'done'
  /** Each takes the ideas ticked, or null for the whole list, or (null and a scope) one section of it. */
  onRead: (ids: string[] | null, scope?: InboxScope) => void
  onDone: (ids: string[] | null, scope?: InboxScope) => void
  onBack: (ids: string[] | null, scope?: InboxScope) => void
  /** By day (the default), or by team; with `onGroupBy`, a switch to change it. */
  groupBy?: 'date' | 'team'
  onGroupBy?: (by: 'date' | 'team') => void
  empty: ReactNode
  more?: { loading: boolean; onMore: () => void } | null
}

export function InboxList({
  rows,
  showing,
  onRead,
  onDone,
  onBack,
  empty,
  more,
  groupBy = 'date',
  onGroupBy,
}: InboxListProps) {
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
  // newest first already: grouped by day, in order; or by team, each section where its newest row is
  const today = new Date().setHours(0, 0, 0, 0)
  const groups: Array<{ key: string; name: string; section: InboxSection | null; rows: InboxRowView[] }> = []
  for (const row of rows) {
    const key = groupBy === 'team' ? row.section.key : dayOf(row.at, today)
    const group = groupBy === 'team' ? groups.find((g) => g.key === key) : groups.at(-1)
    if (group && group.key === key) {
      group.rows.push(row)
    } else {
      groups.push({
        key,
        name: groupBy === 'team' ? row.section.name : key,
        section: groupBy === 'team' ? row.section : null,
        rows: [row],
      })
    }
  }
  return (
    <div className={groupBy === 'team' ? 'inbox is-by-team' : 'inbox'}>
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
            <Button onClick={() => act(onRead)}>{n > 0 ? `Mark ${n} as read` : 'Mark all as read'}</Button>
            <Button onClick={() => act(onDone)}>{n > 0 ? `Mark ${n} as done` : 'Mark all as done'}</Button>
          </>
        ) : (
          <Button onClick={() => act(onBack)}>
            {n > 0 ? `Move ${n} back to the inbox` : 'Move all back to the inbox'}
          </Button>
        )}
        {n > 0 && (
          <Button variant="ghost" onClick={() => setTicked(new Set())}>
            Clear selection
          </Button>
        )}
        {onGroupBy && (
          <span className="inbox-group-by">
            <span aria-hidden>Group by</span>
            <SegmentedControl
              label="Group by"
              options={[
                { value: 'date', label: 'Date' },
                { value: 'team', label: 'Team' },
              ]}
              value={groupBy}
              onChange={onGroupBy}
            />
          </span>
        )}
      </div>
      {groups.map((group) => (
        <section key={group.key} className="inbox-day" aria-label={group.name}>
          {group.section ? (
            <SectionHead
              section={group.section}
              unread={group.rows.filter((r) => r.newCount > 0).length}
              showing={showing}
              onRead={onRead}
              onDone={onDone}
              onBack={onBack}
            />
          ) : (
            <h3 className="inbox-day-title">{group.name}</h3>
          )}
          <ul className="inbox-rows">
            {group.rows.map((row) => (
              <li key={row.id} className={row.newCount > 0 ? 'inbox-row is-unread' : 'inbox-row'}>
                <input
                  type="checkbox"
                  aria-label={`Select ${row.title}`}
                  checked={ticked.has(row.id)}
                  onChange={(event) => tick(row.id, event.target.checked)}
                />
                <span className={`inbox-icon is-${row.kind ?? 'update'}`}>
                  <Icon name={row.kind === 'notice' ? 'group' : (row.kind ?? 'update')} />
                </span>
                <div className="inbox-main">
                  <div className="inbox-title">
                    {/* grouped by team, its section's heading names it */}
                    {groupBy !== 'team' && <span className="inbox-where">{row.where}</span>}
                    <span className="inbox-name">
                      {row.newCount > 0 && (
                        <span className="inbox-dot">
                          <span className="visually-hidden">Unread: </span>
                        </span>
                      )}
                      {row.href ? <Link href={row.href}>{row.title}</Link> : row.title}
                    </span>
                  </div>
                  <div className="inbox-update">
                    {row.actor && <ActorLabel actor={row.actor} short />} {row.update}
                    {row.newCount > 1 && <span className="inbox-new"> · {row.newCount} new</span>}
                  </div>
                </div>
                {/* columns of their own when there's room; a line under the title when there isn't */}
                <div className="inbox-meta">
                  <span className="inbox-state">
                    {row.status && (
                      <StatusPill
                        status={row.status.status}
                        {...(row.status.reason ? { reason: row.status.reason } : {})}
                      />
                    )}
                  </span>
                  <span className={`inbox-reason${row.asked ? ' is-asked' : ''}`}>{row.reason}</span>
                </div>
                <span className="inbox-time">
                  <RelativeTime at={row.at} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more && (
        <Button onClick={more.onMore} disabled={more.loading}>
          {more.loading ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </div>
  )
}

/**
 * A section's heading, grouped by team: its name, how many of its ideas have news, and marking all of it
 * (its rows not loaded yet too) read or done, or, in the Done list, back.
 */
function SectionHead({
  section,
  unread,
  showing,
  onRead,
  onDone,
  onBack,
}: {
  section: InboxSection
  unread: number
  showing: 'inbox' | 'done'
  onRead: InboxListProps['onRead']
  onDone: InboxListProps['onDone']
  onBack: InboxListProps['onBack']
}) {
  return (
    <div className="inbox-section-head">
      <h3 className="inbox-section-title">{section.name}</h3>
      {section.group && <Tag tone="faint">Group</Tag>}
      {unread > 0 && <span className="inbox-section-unread">{unread} unread</span>}
      <span className="inbox-section-actions">
        {showing === 'inbox' ? (
          <>
            {unread > 0 && (
              <Button size="sm" variant="ghost" onClick={() => onRead(null, section.scope)}>
                Mark as read<span className="visually-hidden"> in {section.name}</span>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onDone(null, section.scope)}>
              Mark as done<span className="visually-hidden"> in {section.name}</span>
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onBack(null, section.scope)}>
            Move back to the inbox<span className="visually-hidden"> from {section.name}</span>
          </Button>
        )}
      </span>
    </div>
  )
}
