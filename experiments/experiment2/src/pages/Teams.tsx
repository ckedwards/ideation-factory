// PROTOTYPE: team directory. Search teams, join or leave, watch all updates.
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { ME, type Team } from '../data'
import { useStore } from '../store'
import { canSeeInside, isActive, listedTeams, seesAssignedOnly, visibleIdeas, watchLevel } from '../model'
import { rank } from '../search'
import { MembershipButton } from './members'
import { AvatarStack, Empty, Highlight, PageHeader, SearchInput, WatchSelect, fmt, usePaged, useParam } from '../ui'

export function Teams() {
  const { state } = useStore()
  const [q, setQ] = useParam<string>('q', '')
  const [show, setShow] = useParam<'all' | 'mine' | 'watching' | 'archived'>('show', 'all')
  const [sort, setSort] = useParam<'active' | 'name' | 'size'>('sort', 'active')
  const activity = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of visibleIdeas(state)) if (isActive(state, i)) m.set(i.teamId, (m.get(i.teamId) ?? 0) + 1)
    return m
  }, [state])
  const results = useMemo(() => {
    // archived teams only show under their own filter
    const pool = listedTeams(state).filter((t) =>
      show === 'archived' ? !!t.archivedAt : !t.archivedAt && (show === 'mine' ? t.members.includes(ME) : show === 'watching' ? watchLevel(state, t.id) !== 'participating' : true),
    )
    if (q.trim())
      return rank(pool, q, (t) => [
        { name: 'name', text: t.name, weight: 0 },
        { name: 'description', text: t.description, weight: 3 },
      ]).map((r) => r.item)
    const by =
      sort === 'name'
        ? (a: Team, b: Team) => a.name.localeCompare(b.name)
        : sort === 'size'
          ? (a: Team, b: Team) => b.members.length - a.members.length
          : (a: Team, b: Team) => (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0) || a.name.localeCompare(b.name)
    return [...pool].sort(by)
  }, [state, q, show, sort, activity])
  const { slice, pager } = usePaged(results)

  return (
    <div className="page">
      <PageHeader
        title="Teams"
        sub="Teams group ideas. You can be in several. Watch any team, member or not, to hear about its active ideas or all of them."
        actions={
          <Link className="button primary" to="/teams/new">
            New team
          </Link>
        }
      />
      <SearchInput value={q} onChange={setQ} placeholder="Search teams" label="Search teams" />
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Show">
          {(
            [
              ['all', 'All teams'],
              ['mine', 'Your teams'],
              ['watching', 'Watching'],
              ['archived', 'Archived'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>
              {label}
            </button>
          ))}
        </div>
        {!q.trim() && (
          <label className="filter">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as 'active' | 'name' | 'size')}>
              <option value="active">Most active</option>
              <option value="size">Most members</option>
              <option value="name">Name</option>
            </select>
          </label>
        )}
        <span className="muted toolbar-note">
          {fmt(results.length)} team{results.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="card-list">
        {slice.map((t) => (
          <TeamRow key={t.id} team={t} query={q} open={activity.get(t.id) ?? 0} />
        ))}
      </div>
      {pager}
      {results.length === 0 && <Empty>No teams match{q.trim() ? ` “${q.trim()}”` : ''}.</Empty>}
    </div>
  )
}

function TeamRow({ team, query, open }: { team: Team; query: string; open: number }) {
  return (
    <article className="team-row">
      <div className="team-row-main">
        <Link to="/teams/$teamId" params={{ teamId: team.id }} className="team-row-name">
          <Highlight text={team.name} query={query} />
        </Link>
        <p className="team-row-desc">
          <Highlight text={team.description} query={query} />
        </p>
        <div className="team-row-meta">
          <AvatarStack ids={team.members} max={5} />
          <span className="muted">
            {fmt(team.members.length)} member{team.members.length === 1 ? '' : 's'} ·{' '}
            {!canSeeInside(team)
              ? 'ideas visible to members only'
              : seesAssignedOnly(team)
                ? `${fmt(open)} active idea${open === 1 ? '' : 's'} you’re on`
                : `${fmt(open)} active idea${open === 1 ? '' : 's'}`}
          </span>
          {team.members.includes(ME) && <span className="tag">Member</span>}
          {team.locked && <LockedTag />}
          {team.joinPolicy === 'invite' && <span className="tag">Invite only</span>}
          {team.archivedAt && <span className="tag tag-archived">Archived</span>}
        </div>
      </div>
      <TeamActions team={team} />
    </article>
  )
}

export function LockedTag() {
  return (
    <span className="tag tag-locked" title="Only members can see its ideas or get notifications about them">
      🔒 Locked
    </span>
  )
}

export function TeamActions({ team }: { team: Team }) {
  if (team.archivedAt) return <span className="muted">Read-only</span>
  return (
    <div className="team-actions">
      {/* watching a locked team you can't see into would tell you nothing */}
      {canSeeInside(team) && <WatchSelect teamId={team.id} label="Notify" />}
      <MembershipButton entity="team" m={team} />
    </div>
  )
}
