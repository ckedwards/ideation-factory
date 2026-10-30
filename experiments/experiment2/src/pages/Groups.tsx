// PROTOTYPE: groups. Anyone can create one; a group can be asked to review an
// idea, which notifies everyone in it.
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { ME } from '../data'
import { useStore } from '../store'
import { ago, isActive, isOpen, visibleIdeas } from '../model'
import { rank } from '../search'
import { AvatarStack, Combobox, Empty, Highlight, PageHeader, SearchInput, fmt, usePaged, useParam, usePeopleSearch } from '../ui'

export function Groups() {
  const { state } = useStore()
  const [q, setQ] = useParam<string>('q', '')
  const [show, setShow] = useParam<'all' | 'mine'>('show', 'all')
  const [member, setMember] = useParam<string>('member', '')
  const people = usePeopleSearch()
  const reviewing = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of visibleIdeas(state)) if (isActive(state, i)) for (const r of i.reviewers) if (r.kind === 'group') m.set(r.groupId, (m.get(r.groupId) ?? 0) + 1)
    return m
  }, [state])
  const results = useMemo(() => {
    const who = member === 'me' ? ME : member
    const pool = state.groups.filter((g) => !g.deletedAt && (show === 'mine' ? g.members.includes(ME) : true) && (!who || g.members.includes(who)))
    return q.trim()
      ? rank(pool, q, (g) => [
          { name: 'name', text: g.name, weight: 0 },
          { name: 'description', text: g.description, weight: 3 },
        ]).map((r) => r.item)
      : [...pool].sort((a, b) => a.name.localeCompare(b.name))
  }, [state.groups, q, show, member])
  const { slice, pager } = usePaged(results)

  return (
    <div className="page">
      <PageHeader
        title="Groups"
        sub="A group bundles people so an idea can ask all of them for review at once, and teams build approval requirements from groups. Anyone can create one."
        actions={
          <Link className="button primary" to="/groups/new">
            New group
          </Link>
        }
      />
      <SearchInput value={q} onChange={setQ} placeholder="Search groups" label="Search groups" />
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Show">
          {(
            [
              ['all', 'All groups'],
              ['mine', 'Your groups'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="filter">
          <span>Includes</span>
          <Combobox
            label="Group member"
            anyLabel="Anyone"
            placeholder="Search by name or @handle."
            value={member}
            onChange={setMember}
            search={people.search}
            display={(id) => (id === 'me' ? { id, label: 'You', avatar: ME } : people.option(id))}
            pinned={[{ id: 'me', label: 'You', avatar: ME }]}
          />
        </div>
        <span className="muted toolbar-note">
          {fmt(results.length)} group{results.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="card-list">
        {slice.map((g) => {
          const n = reviewing.get(g.id) ?? 0
          return (
            <article key={g.id} className="group-row">
              <div className="group-row-main">
                <div className="group-row-name">
                  <Link to="/groups/$groupId" params={{ groupId: g.id }} className="group-row-link">
                    <Highlight text={g.name} query={q} />
                  </Link>
                  {g.members.includes(ME) && <span className="tag">You’re in it</span>}
                  {g.joinPolicy === 'invite' && <span className="tag">Invite only</span>}
                </div>
                {g.description && (
                  <p className="group-row-desc">
                    <Highlight text={g.description} query={q} />
                  </p>
                )}
                <div className="group-row-members">
                  <AvatarStack ids={g.members} max={8} />
                  <span className="muted">
                    {fmt(g.members.length)} {g.members.length === 1 ? 'person' : 'people'}
                  </span>
                </div>
              </div>
              <div className="group-row-side">
                <span className="muted">
                  Created by {g.createdBy === ME ? 'you' : state.users[g.createdBy]?.name} · {ago(g.createdAt)}
                </span>
                <span>
                  Reviewing {fmt(n)} active idea{n === 1 ? '' : 's'}
                </span>
              </div>
            </article>
          )
        })}
      </div>
      {pager}
      {results.length === 0 && <Empty>No groups match.</Empty>}
    </div>
  )
}
