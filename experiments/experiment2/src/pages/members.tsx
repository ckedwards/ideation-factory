// PROTOTYPE: membership pieces shared by team and group pages and settings.
import { useMemo, useState } from 'react'
import { ME, type Group, type Team } from '../data'
import { useStore, type Entity } from '../store'
import { isActive, roleOf, usesGroup } from '../model'
import { rank } from '../search'
import { Avatar, Dialog, InactiveTag, SearchInput, fmt } from '../ui'

type Membership = Team | Group

export function RoleTag({ m, userId }: { m: Membership; userId: string }) {
  const role = roleOf(m, userId)
  if (role === 'admin') return <span className="tag role-admin">Admin</span>
  if (role === 'maintainer') return <span className="tag role-maintainer">Maintainer</span>
  return null
}

// Join (open), ask to join (invite only), cancel a request, or leave.
export function MembershipButton({ entity, m, disabled }: { entity: Entity; m: Membership; disabled?: string }) {
  const { dispatch } = useStore()
  const noun = entity === 'team' ? 'team' : 'group'
  const member = m.members.includes(ME)
  const requested = m.requests.some((r) => r.userId === ME)
  const [confirming, setConfirming] = useState(false)
  const act = (op: 'join' | 'leave' | 'request' | 'cancel', text: string) => {
    dispatch({ type: 'membership', entity, id: m.id, op })
    dispatch({ type: 'toast', text })
  }
  if (disabled)
    return (
      <button disabled title={disabled}>
        {member ? `Leave ${noun}` : `Join ${noun}`}
      </button>
    )
  if (member)
    return (
      <>
        <button
          onClick={() => setConfirming(true)}
          disabled={m.admins.length === 1 && m.admins[0] === ME}
          title={m.admins.length === 1 && m.admins[0] === ME ? `You’re the only admin. Make someone else an admin first.` : undefined}
        >
          Leave {noun}
        </button>
        {confirming && (
          <LeaveDialog
            entity={entity}
            m={m}
            onClose={() => setConfirming(false)}
            onLeave={() => {
              setConfirming(false)
              act('leave', `Left ${m.name}`)
            }}
          />
        )}
      </>
    )
  if (requested)
    return (
      <span className="requested">
        <span className="tag">Request sent</span>
        <button className="link" onClick={() => act('cancel', `Cancelled your request to join ${m.name}`)}>
          Cancel request
        </button>
      </span>
    )
  if (m.joinPolicy === 'invite')
    return (
      <button className="primary" onClick={() => act('request', `Asked to join ${m.name}. A maintainer or admin will approve or deny it.`)} title="This is invite only. A maintainer or admin approves requests.">
        Request to join
      </button>
    )
  return (
    <button className="primary" onClick={() => act('join', `Joined ${m.name}`)}>
      Join {noun}
    </button>
  )
}

// Admins and maintainers first, then everyone else. Big lists: first 12, then
// a searchable list 30 at a time.
export function MembersList({ m, preview = 12 }: { m: Membership; preview?: number }) {
  const { state } = useStore()
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const size = 30
  const ordered = useMemo(() => {
    const order = (id: string) => (m.admins.includes(id) ? 0 : m.maintainers.includes(id) ? 1 : id === ME ? 2 : 3)
    return [...m.members].sort((a, b) => order(a) - order(b))
  }, [m])
  const list = q.trim()
    ? rank(ordered.map((id) => state.users[id]).filter(Boolean), q.replace(/^@/, ''), (u) => [
        { name: 'name', text: u.name, weight: 0 },
        { name: 'handle', text: u.handle, weight: 1 },
      ]).map((r) => r.item.id)
    : ordered
  const shown = all ? list.slice(page * size, (page + 1) * size) : list.slice(0, preview)
  return (
    <div className="members">
      {all && m.members.length > preview && (
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v)
            setPage(0)
          }}
          placeholder="Find a member"
          label="Find a member"
        />
      )}
      <ul className="people">
        {shown.map((id) => (
          <li key={id} title={`@${state.users[id]?.handle}`}>
            <Avatar userId={id} size="sm" /> {state.users[id]?.name}
            <RoleTag m={m} userId={id} />
            <InactiveTag userId={id} />
          </li>
        ))}
      </ul>
      {!all && m.members.length > preview && (
        <button className="link" onClick={() => setAll(true)}>
          Show all {fmt(m.members.length)} members
        </button>
      )}
      {all && list.length > size && (
        <div className="pager pager-small">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            ←
          </button>
          <span className="pager-pages">
            {fmt(page * size + 1)}–{fmt(Math.min((page + 1) * size, list.length))} of {fmt(list.length)}
          </span>
          <button disabled={(page + 1) * size >= list.length} onClick={() => setPage(page + 1)}>
            →
          </button>
        </div>
      )}
    </div>
  )
}

// "Are you sure?" for leaving, with what you'd lose.
function LeaveDialog({ entity, m, onClose, onLeave }: { entity: Entity; m: Membership; onClose: () => void; onLeave: () => void }) {
  const { state } = useStore()
  const noun = entity === 'team' ? 'team' : 'group'
  const role = roleOf(m, ME)
  const reviewing = entity === 'group' ? state.ideas.filter((i) => isActive(state, i) && i.reviewers.some((r) => r.kind === 'group' && r.groupId === m.id)).length : 0
  const requiredBy =
    entity === 'group'
      ? state.teams.filter((t) => !t.archivedAt && usesGroup(t, m.id).length > 0)
      : []
  return (
    <Dialog
      title={`Leave ${m.name}?`}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="danger-solid" onClick={onLeave}>
            Leave {noun}
          </button>
        </>
      }
    >
      <ul className="consequences">
        {role === 'admin' && <li>You’ll stop being an admin of {m.name}.</li>}
        {role === 'maintainer' && <li>You’ll stop being a maintainer of {m.name}, so you won’t be able to approve requests or change requirements.</li>}
        {entity === 'group' && (
          <li>
            You’ll stop getting review requests sent to {m.name}
            {reviewing > 0 && <>, including the {fmt(reviewing)} active idea{reviewing === 1 ? '' : 's'} it’s reviewing now</>}.
          </li>
        )}
        {requiredBy.length > 0 && (
          <li>
            Your approvals will stop counting as {m.name} approvals in {requiredBy.map((t) => t.name).join(', ')}’s approval requirements.
          </li>
        )}
        {entity === 'team' && (m as Team).locked && (
          <li>
            <b>{m.name} is locked, so you’ll lose access to its ideas straight away</b>, including ones you wrote or review, and stop getting notifications about them.
          </li>
        )}
        {entity === 'team' && !(m as Team).locked && <li>Ideas you wrote or review in {m.name} stay as they are. Watching it is separate and doesn’t change.</li>}
        <li>{m.joinPolicy === 'invite' ? `${m.name} is invite only, so to come back you’ll have to ask, and a maintainer or admin will need to approve it.` : `You can join again any time.`}</li>
      </ul>
    </Dialog>
  )
}
