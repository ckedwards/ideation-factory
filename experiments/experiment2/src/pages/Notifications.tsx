// PROTOTYPE: notifications, modeled on GitHub's. One compact row per idea,
// optionally grouped by team, with Inbox / Done, reason and team filters on the
// left. Rows are plain: an icon for what happened, the idea, why you're here and
// when. No per-row actions; read / done apply to the filtered list, and
// unsubscribing lives on the idea and under "Subscriptions".
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useStore } from '../store'
import { ago, following, reasonText, threads, watchLevel, type Thread, type ThreadReason } from '../model'
import { rank } from '../search'
import { ActorLabel, Empty, Highlight, IdeaLink, IdeaState, PageHeader, SearchInput, StatusPill, TeamChip, WatchSelect, fmt, usePaged, useParam, useSetParams } from '../ui'

// Simple line icons, one per kind of update. Closing gets its own icon per
// outcome, so accepted and rejected read differently at a glance.
type IconName = 'review' | 'comment' | 'suggestion' | 'version' | 'status' | 'new' | 'approved' | 'accepted' | 'rejected' | 'closed'
const ICON_PATHS: Record<IconName, ReactNode> = {
  // eye
  review: (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  // speech bubble
  comment: <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2Z" />,
  // pencil
  suggestion: <path d="M10.5 2.5l3 3-8 8h-3v-3Z M9 4l3 3" />,
  // arrow up into a tray
  version: <path d="M8 10.5V2.5 M5 5.5l3-3 3 3 M2.5 10v3.5h11V10" />,
  // dot in a ring
  status: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  // plus in a page
  new: <path d="M3.5 1.5h6l3 3v10h-9Z M8 7v5 M5.5 9.5h5" />,
  // check
  approved: <path d="M2.5 8.5l3.5 3.5 7.5-8" />,
  // check in a circle
  accepted: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5 8.25l2 2 4-4.25" />
    </>
  ),
  // x in a circle
  rejected: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.75 5.75l4.5 4.5 M10.25 5.75l-4.5 4.5" />
    </>
  ),
  // filled square
  closed: <rect x="3.5" y="3.5" width="9" height="9" rx="1" />,
}
const KIND_ICON: Record<string, IconName> = {
  'review-requested': 'review',
  comment: 'comment',
  suggestion: 'suggestion',
  version: 'version',
  status: 'status',
  'new-idea': 'new',
  approved: 'approved',
  closed: 'closed',
}
const ICON_LABEL: Record<IconName, string> = {
  review: 'Review requested',
  comment: 'Comment',
  suggestion: 'Suggested edit',
  version: 'New version',
  status: 'Status changed',
  new: 'New idea',
  approved: 'Approved',
  accepted: 'Closed as accepted',
  rejected: 'Closed as rejected',
  closed: 'Closed',
}
function threadIcon(t: Thread): IconName {
  if (t.latest.kind !== 'closed') return KIND_ICON[t.latest.kind] ?? 'status'
  const reason = t.idea.closedReason ?? (/rejected/.test(t.latest.text) ? 'rejected' : /accepted/.test(t.latest.text) ? 'accepted' : undefined)
  return reason ?? 'closed'
}
function UpdateIcon({ name }: { name: IconName }) {
  return (
    <span className={`thread-icon icon-${name}`} title={ICON_LABEL[name]} role="img" aria-label={ICON_LABEL[name]}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICON_PATHS[name]}
      </svg>
    </span>
  )
}

export function Notifications() {
  const [tab, setTab] = useParam<'inbox' | 'following'>('tab', 'inbox')
  const { state } = useStore()
  const unread = threads(state).filter((t) => t.unread > 0 && !t.done).length
  return (
    <div className="page page-wide">
      <PageHeader title="Notifications" sub="One row per idea you’re subscribed to. Opening an idea marks it read. To stop hearing about one, unsubscribe on the idea or under Subscriptions." />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'inbox'} className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>
          Inbox {unread > 0 && <span className="tag">{unread}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'following'} className={tab === 'following' ? 'on' : ''} onClick={() => setTab('following')}>
          Subscriptions
        </button>
      </div>
      {tab === 'inbox' ? <Inbox /> : <Following />}
    </div>
  )
}

type Box = 'inbox' | 'done'
type ReasonFilter = 'all' | 'review' | 'participating' | 'watching'
const PARTICIPATING: ThreadReason[] = ['review', 'author', 'reviewer', 'group', 'subscribed']

function Inbox() {
  const { state, dispatch } = useStore()
  const [box, setBox] = useParam<Box>('box', 'inbox')
  const [reason, setReason] = useParam<ReasonFilter>('reason', 'all')
  const [team, setTeam] = useParam<string>('team', '')
  const [group, setGroup] = useParam<'date' | 'team'>('group', 'date')
  const [unreadOnly, setUnreadOnly] = useParam<'' | 'yes'>('unread', '')
  const setParams = useSetParams()

  const all = useMemo(() => threads(state), [state])
  const inBox = all.filter((t) => (box === 'done' ? t.done : !t.done))
  const byReason = (t: Thread, r: ReasonFilter) =>
    r === 'all' ? true : r === 'review' ? t.reason === 'review' : r === 'watching' ? t.reason === 'watching' : PARTICIPATING.includes(t.reason)
  const list = inBox.filter((t) => byReason(t, reason) && (!team || t.idea.teamId === team) && (!unreadOnly || t.unread > 0))
  const { slice, pager } = usePaged(list)

  // left column counts (within the current box)
  const count = (r: ReasonFilter) => inBox.filter((t) => byReason(t, r)).length
  const teamCounts = (() => {
    const m = new Map<string, number>()
    for (const t of inBox) m.set(t.idea.teamId, (m.get(t.idea.teamId) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  })()

  // group the current page by date or by team
  const sections: { key: string; title: ReactNode; items: Thread[] }[] = []
  const when = (iso: string) => {
    const days = Math.floor((Date.parse('2026-10-24') - Date.parse(iso.slice(0, 10))) / 86_400_000)
    return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Older'
  }
  for (const t of slice) {
    const key = group === 'team' ? t.idea.teamId : when(t.latest.at)
    let sec = sections.find((x) => x.key === key)
    if (!sec) sections.push((sec = { key, title: group === 'team' ? <TeamChip teamId={key} /> : key, items: [] }))
    sec.items.push(t)
  }
  const ids = (ts: Thread[]) => ts.map((t) => t.idea.id)

  // selection: only what's still in the filtered list counts
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const selected = list.filter((t) => picked.has(t.idea.id))
  // in display order (grouping by team reorders the page)
  const pageIds = sections.flatMap((sec) => ids(sec.items))
  const pageSelected = pageIds.filter((id) => picked.has(id)).length
  // Shift-click selects (or clears) everything between the last row you clicked
  // and this one, matching the state this row is switching to.
  const anchor = useRef<string | null>(null)
  const toggle = (id: string, shift: boolean) => {
    const on = !picked.has(id)
    const from = anchor.current ? pageIds.indexOf(anchor.current) : -1
    const to = pageIds.indexOf(id)
    const range = shift && from >= 0 ? pageIds.slice(Math.min(from, to), Math.max(from, to) + 1) : [id]
    setPicked((p) => {
      const n = new Set(p)
      for (const x of range) on ? n.add(x) : n.delete(x)
      return n
    })
    anchor.current = id
  }
  const togglePage = () =>
    setPicked((p) => {
      const n = new Set(p)
      for (const id of pageIds) pageSelected === pageIds.length ? n.delete(id) : n.add(id)
      return n
    })
  // "Mark all" acts on the filtered list; with a selection, it acts on just those
  const targets = selected.length ? selected : list
  const label = selected.length ? fmt(selected.length) : 'all'
  const act = (a: 'read' | 'done' | 'undone') => {
    const ideaIds = ids(targets)
    if (a === 'read') dispatch({ type: 'markIdeasRead', ideaIds, read: true })
    else dispatch({ type: 'markDone', ideaIds, done: a === 'done' })
    setPicked(new Set())
  }
  const selectAll = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = pageSelected > 0 && pageSelected < pageIds.length
  })

  return (
    <div className="inbox">
      <aside className="inbox-filters" aria-label="Filter notifications">
        <div className="inbox-filter-group">
          {(
            [
              ['inbox', 'Inbox', all.filter((t) => !t.done && t.unread > 0).length],
              ['done', 'Done', all.filter((t) => t.done).length],
            ] as const
          ).map(([k, label, n]) => (
            <button key={k} className={box === k ? 'on' : ''} onClick={() => setBox(k)}>
              {label} {n > 0 && <span className="inbox-count">{fmt(n)}</span>}
            </button>
          ))}
        </div>
        <div className="inbox-filter-head">Reason</div>
        <div className="inbox-filter-group">
          {(
            [
              ['all', 'Everything'],
              ['review', 'Review requested'],
              ['participating', 'Participating'],
              ['watching', 'Watching a team'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={reason === k ? 'on' : ''} onClick={() => setReason(k)} title={k === 'participating' ? 'You wrote it, review it (directly or via a group), or subscribed' : undefined}>
              {label} <span className="inbox-count">{fmt(count(k))}</span>
            </button>
          ))}
        </div>
        <div className="inbox-filter-head">Teams</div>
        <div className="inbox-filter-group">
          {team && (
            <button onClick={() => setTeam('')} className="inbox-clear">
              ✕ All teams
            </button>
          )}
          {teamCounts.slice(0, 12).map(([id, n]) => (
            <button key={id} className={team === id ? 'on' : ''} onClick={() => setTeam(team === id ? '' : id)}>
              {state.teams.find((t) => t.id === id)?.name ?? id} <span className="inbox-count">{fmt(n)}</span>
            </button>
          ))}
          {teamCounts.length > 12 && <span className="hint inbox-more">and {teamCounts.length - 12} more teams</span>}
        </div>
      </aside>

      <div className="inbox-main">
        <div className="toolbar">
          {slice.length > 0 && (
            <label className="thread-pick thread-pick-all" title="Select everything on this page">
              <input
                ref={selectAll}
                type="checkbox"
                className="thread-check"
                checked={pageSelected > 0 && pageSelected === pageIds.length}
                onChange={togglePage}
                aria-label="Select everything on this page"
              />
            </label>
          )}
          <label className="filter">
            <span>Group by</span>
            <select value={group} onChange={(e) => setGroup(e.target.value as 'date' | 'team')}>
              <option value="date">Date</option>
              <option value="team">Team</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={!!unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked ? 'yes' : '')} /> Unread only
          </label>
          {(reason !== 'all' || team || unreadOnly) && (
            <button className="link" onClick={() => setParams({ reason: undefined, team: undefined, unread: undefined })}>
              Clear filters
            </button>
          )}
          <span className="toolbar-note muted">
            {fmt(list.length)} idea{list.length === 1 ? '' : 's'}
          </span>
          {selected.length > 0 && (
            <button className="link" onClick={() => setPicked(new Set())}>
              Clear selection
            </button>
          )}
          {list.length > 0 && box === 'inbox' && (
            <>
              <button className={selected.length ? 'is-selection' : ''} onClick={() => act('read')}>
                Mark {label} as read
              </button>
              <button className={selected.length ? 'is-selection' : ''} onClick={() => act('done')}>
                Mark {label} as done
              </button>
            </>
          )}
          {selected.length > 0 && box === 'done' && (
            <button className="is-selection" onClick={() => act('undone')}>
              Move {label} back to the inbox
            </button>
          )}
        </div>

        {sections.map((sec) => (
          <section key={sec.key} className="inbox-section">
            <header className="inbox-section-head">
              <span>{sec.title}</span>
              {group === 'team' && box === 'inbox' && (
                <button className="link" onClick={() => dispatch({ type: 'markDone', ideaIds: ids(sec.items), done: true })}>
                  Mark these done
                </button>
              )}
            </header>
            <div className="inbox-list">
              {sec.items.map((t) => (
                <ThreadRow key={t.idea.id} t={t} showTeam={group !== 'team'} selected={picked.has(t.idea.id)} onSelect={(shift) => toggle(t.idea.id, shift)} />
              ))}
            </div>
          </section>
        ))}
        {pager}
        {list.length === 0 && <Empty>{box === 'done' ? 'Nothing marked done.' : unreadOnly ? 'No unread notifications. 🎉' : 'All caught up.'}</Empty>}
      </div>
    </div>
  )
}

// One idea in the inbox: what happened last, how much is new, why you're here.
export function ThreadRow({
  t,
  showTeam = true,
  compact,
  selected,
  onSelect,
}: {
  t: Thread
  showTeam?: boolean
  compact?: boolean
  selected?: boolean
  onSelect?: (shift: boolean) => void
}) {
  const others = t.ns.length - 1
  return (
    // unread: a bar down the left edge (and bold title), not a dot
    <article className={`thread ${t.unread ? 'is-unread' : ''} ${compact ? 'is-compact' : ''} ${selected ? 'is-selected' : ''}`} aria-label={t.unread ? `Unread: ${t.idea.title}` : undefined}>
      {onSelect && (
        // The whole left gutter is the target, not just the box. Clicks on the
        // gutter, on the box, and Space on the focused box (which fires a click)
        // all bubble here, so Shift works for each. Not a <label>: the box
        // toggles natively and this keeps React's state in step with it.
        <div
          className="thread-pick"
          onMouseDown={(e) => e.shiftKey && e.preventDefault() /* no text selection on shift-click */}
          onClick={(e) => onSelect(e.shiftKey)}
        >
          <input type="checkbox" className="thread-check" checked={!!selected} onChange={() => {}} aria-label={`Select “${t.idea.title}”`} />
        </div>
      )}
      <UpdateIcon name={threadIcon(t)} />
      <div className="thread-main">
        <div className="thread-title">
          {showTeam && <TeamChip teamId={t.idea.teamId} />}
          <IdeaLink idea={t.idea} className="thread-idea">
            {t.idea.title}
          </IdeaLink>
        </div>
        <div className="thread-sub">
          <ActorLabel actor={t.latest.actor} short /> <span>{t.latest.text}</span>
          {t.unread > 1 ? <span className="thread-new">· {t.unread} new</span> : others > 0 ? <span className="muted">· {others + 1} updates</span> : null}
        </div>
      </div>
      <IdeaState idea={t.idea} compact={compact} />
      {!compact && <span className={`thread-reason reason-${t.reason}`} title={t.reasonLabel}>{t.reasonLabel}</span>}
      <span className="thread-time">{ago(t.latest.at)}</span>
    </article>
  )
}

function Following() {
  const { state, dispatch } = useStore()
  const [q, setQ] = useParam<string>('q', '')
  const [why, setWhy] = useParam<'any' | 'involved' | 'watching'>('why', 'any')
  const all = useMemo(() => following(state).sort((a, b) => Date.parse(b.idea.updatedAt) - Date.parse(a.idea.updatedAt)), [state])
  const list = useMemo(() => {
    const byWhy = all.filter(({ reasons }) =>
      why === 'watching' ? reasons.every((r) => r.kind === 'team-watch') : why === 'involved' ? reasons.some((r) => r.kind !== 'team-watch') : true,
    )
    return q.trim() ? rank(byWhy, q, (f) => [{ name: 'title', text: f.idea.title, weight: 0 }]).map((r) => r.item) : byWhy
  }, [all, why, q])
  const { slice, pager } = usePaged(list)
  const watched = state.teams.filter((t) => watchLevel(state, t.id) !== 'participating')

  return (
    <>
      <p className="hint">
        You’re subscribed to an idea automatically when you write it or are asked to review it (directly or through a group). Watching a team
        subscribes you to its active ideas (out of draft, through to closing) or all of its ideas (drafts too). Unsubscribing from an idea stops its
        notifications without changing anything else.
      </p>

      <section className="section">
        <h2>
          Teams you’re watching <span className="muted">{watched.length}</span>
        </h2>
        <div className="card-list">
          {watched.map((t) => (
            <div key={t.id} className="follow-team">
              <Link to="/teams/$teamId" params={{ teamId: t.id }} className="follow-team-name">
                {t.name}
              </Link>
              <span className="muted">{fmt(t.members.length)} members</span>
              <WatchSelect teamId={t.id} label="Notify me about" />
            </div>
          ))}
          {watched.length === 0 && (
            <Empty>
              You’re not watching any teams. <Link to="/teams">Browse teams</Link> to watch one.
            </Empty>
          )}
        </div>
      </section>

      <section className="section">
        <h2>
          Ideas you’re subscribed to <span className="muted">{fmt(all.length)}</span>
        </h2>
        <SearchInput value={q} onChange={setQ} placeholder="Search your subscriptions" label="Search your subscriptions" />
        <div className="toolbar">
          <label className="filter">
            <span>Why</span>
            <select value={why} onChange={(e) => setWhy(e.target.value as 'any' | 'involved' | 'watching')}>
              <option value="any">Any reason</option>
              <option value="involved">You’re involved</option>
              <option value="watching">Only through a team you watch</option>
            </select>
          </label>
          <span className="muted toolbar-note">
            {fmt(list.length)} idea{list.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="follow-table" role="table">
          {slice.map(({ idea, reasons, muted }) => (
            <div key={idea.id} className={`follow-row ${muted ? 'is-muted' : ''}`} role="row">
              <div className="follow-idea" role="cell">
                <IdeaLink idea={idea} className="follow-title">
                  <Highlight text={idea.title} query={q} />
                </IdeaLink>
                <span className="follow-meta">
                  <TeamChip teamId={idea.teamId} /> <StatusPill status={idea.status} reason={idea.closedReason} />
                </span>
              </div>
              <div className="follow-reasons" role="cell">
                {reasons.map((r, i) => (
                  <span key={i} className="tag tag-reason">
                    {reasonText(state, r)}
                  </span>
                ))}
              </div>
              <div role="cell">
                <button className={muted ? 'primary' : ''} onClick={() => dispatch({ type: 'toggleMute', ideaId: idea.id })}>
                  {muted ? 'Subscribe' : 'Unsubscribe'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {pager}
        {list.length === 0 && <Empty>No subscriptions match.</Empty>}
      </section>
    </>
  )
}
