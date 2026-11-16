// A team's or a group's members, for someone who can manage them, as a table: each person (you
// marked), their role and when they joined, filtered by name or handle and sorted by name, role or
// when they joined. A row's actions are in its menu: admins change roles, maintainers remove members,
// admins anyone, and anyone can leave, each asked first; adding someone is a dialog.
import { useEffect, useState } from 'react'
import { Button, Dialog, Link, type Person, RowMenu, SearchInput, Select, Stack, Tag, UserName } from '@ideaf/ui'
import type { MemberInfo } from './MemberList.tsx'
import { PersonPicker } from './PersonPicker.tsx'
import './MemberTable.css'

type Role = MemberInfo['role']

const ROLES: { value: Role; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'maintainer', label: 'Maintainer' },
  { value: 'admin', label: 'Admin' },
]

export type MemberSort = 'name' | 'role' | 'joined'

/** What the table shows: a search, and its sort. */
export interface MemberView {
  q?: string
  sort?: MemberSort
  order?: 'asc' | 'desc'
}

const SORTS: { value: MemberSort; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'role', label: 'Role' },
  { value: 'joined', label: 'Joined' },
]

const day = (at: number) => new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })

export interface MemberTableProps {
  members: MemberInfo[]
  /** You, and your role here. */
  you: { id: string; role: Role }
  view: MemberView
  onView: (view: MemberView) => void
  onRole: (person: Person, role: Role) => void
  onRemove: (person: Person) => void
  onAdd: (person: Person, role: Role) => void
  /** The team's or group's name, for what removing someone means. */
  name?: string
  /** While the members for a new search or sort are coming. */
  loading?: boolean
  more?: { loading: boolean; onMore: () => void } | null
}

export function MemberTable({
  members,
  you,
  view,
  onView,
  onRole,
  onRemove,
  onAdd,
  name,
  loading,
  more,
}: MemberTableProps) {
  const where = name ?? 'it'
  const admin = you.role === 'admin'
  const [text, setText] = useState(view.q ?? '')
  const [adding, setAdding] = useState(false)
  // asked first: who'd be removed (or you, leaving)
  const [removing, setRemoving] = useState<Person | null>(null)
  const sort = view.sort ?? 'name'
  const order = view.order ?? 'asc'
  // the search, once typing pauses
  useEffect(() => {
    const q = text.trim()
    if (q === (view.q ?? '')) {
      return
    }
    const timer = setTimeout(() => {
      const { q: _, ...rest } = view
      onView(q ? { ...rest, q } : rest)
    }, 250)
    return () => clearTimeout(timer)
  }, [text, view, onView])
  // only someone's own membership can be changed or ended here: one through a group follows the group
  const direct = (member: MemberInfo) => member.direct !== null
  const removable = (member: MemberInfo) =>
    direct(member) &&
    (member.person.id === you.id || admin || (you.role === 'maintainer' && (member.direct ?? member.role) === 'member'))
  const sources = members.some((m) => (m.through?.length ?? 0) > 0)

  return (
    <Stack gap={4}>
      <div className="member-toolbar">
        <div className="member-toolbar-search">
          <SearchInput label="Filter members" placeholder="Filter members" value={text} onChange={setText} />
        </div>
        <div className="member-toolbar-sort">
          <Select
            aria-label="Sort by"
            options={SORTS}
            value={sort}
            onChange={(next) => onView({ ...view, sort: next })}
          />
          <Button
            variant="ghost"
            aria-label={order === 'asc' ? 'Ascending: reverse it' : 'Descending: reverse it'}
            title={order === 'asc' ? 'Ascending' : 'Descending'}
            onClick={() => onView({ ...view, order: order === 'asc' ? 'desc' : 'asc' })}
          >
            {order === 'asc' ? '↑' : '↓'}
          </Button>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add someone
        </Button>
      </div>
      {members.length === 0 && !loading ? (
        <p className="member-none">{view.q ? `No member matches “${view.q}”.` : 'No members yet.'}</p>
      ) : (
        <table className="member-table" aria-label="Members" aria-busy={loading || undefined}>
          <thead>
            <tr>
              <th scope="col">Account</th>
              {sources && <th scope="col">Source</th>}
              <th scope="col">Role</th>
              <th scope="col">Joined</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const yours = member.person.id === you.id
              return (
                <tr key={member.person.id}>
                  <td data-label="Account">
                    <div className="member-account">
                      <UserName person={member.person} withAvatar />
                      {yours && <Tag tone="ok">It’s you</Tag>}
                      <span className="member-handle">@{member.person.handle}</span>
                    </div>
                  </td>
                  {sources && (
                    <td data-label="Source">
                      <div className="member-source">
                        {direct(member) && <span>Direct</span>}
                        {member.through?.map((t) => (
                          <span key={t.group.id}>
                            Through <Link href={`/groups/${t.group.handle}`}>{t.group.name}</Link>
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                  <td data-label="Role">
                    <span className="member-row-role">{ROLES.find((r) => r.value === member.role)?.label}</span>
                    {direct(member) && member.direct && member.direct !== member.role && (
                      <span className="member-row-role">
                        {' '}
                        (theirs: {ROLES.find((r) => r.value === member.direct)?.label}; higher through a group)
                      </span>
                    )}
                  </td>
                  <td data-label="Joined" className="member-joined">
                    {member.joined ? (
                      <time dateTime={new Date(member.joined).toISOString()}>{day(member.joined)}</time>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="member-actions">
                    <RowMenu
                      label={member.person.name}
                      groups={[
                        {
                          label: 'Role',
                          // their own membership's role, which is what this changes
                          items:
                            admin && direct(member)
                              ? ROLES.map((r) => ({
                                  label: r.label,
                                  current: (member.direct ?? member.role) === r.value,
                                  onSelect: () => onRole(member.person, r.value),
                                }))
                              : [],
                        },
                        {
                          items: removable(member)
                            ? [
                                {
                                  label: yours ? 'Leave' : 'Remove',
                                  danger: true,
                                  onSelect: () => setRemoving(member.person),
                                },
                              ]
                            : [],
                        },
                      ]}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {more && (
        <div>
          <Button variant="ghost" onClick={more.onMore} disabled={more.loading}>
            {more.loading ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
      <Dialog
        open={removing !== null}
        title={removing?.id === you.id ? `Leave ${where}?` : `Remove ${removing?.name ?? ''}?`}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) {
                  onRemove(removing)
                }
                setRemoving(null)
              }}
            >
              {removing?.id === you.id ? 'Leave' : 'Remove'}
            </Button>
          </>
        }
      >
        <p>
          {removing?.id === you.id ? 'You' : removing?.name} will no longer be a member of {where}, and lose what its
          members can see and do: its ideas shared with its members, and starting ideas in it.
          {removing?.id === you.id ? ' To come back, you’ll have to be added again, or ask to join.' : ''}
        </p>
      </Dialog>
      <AddMember
        open={adding}
        admin={admin}
        exclude={members.map((m) => m.person.id)}
        onClose={() => setAdding(false)}
        onAdd={(person, role) => {
          onAdd(person, role)
          setAdding(false)
        }}
      />
    </Stack>
  )
}

function AddMember(props: {
  open: boolean
  admin: boolean
  exclude: string[]
  onClose: () => void
  onAdd: (person: Person, role: Role) => void
}) {
  const [person, setPerson] = useState<Person | null>(null)
  const [role, setRole] = useState<Role>('member')
  const close = () => {
    setPerson(null)
    setRole('member')
    props.onClose()
  }
  return (
    <Dialog
      open={props.open}
      title="Add someone"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!person}
            onClick={() => {
              if (person) {
                props.onAdd(person, role)
                setPerson(null)
                setRole('member')
              }
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <Stack gap={3}>
        <PersonPicker label="Who" value={person} onChange={setPerson} exclude={props.exclude} />
        {props.admin && <Select aria-label="As" options={ROLES} value={role} onChange={setRole} />}
      </Stack>
    </Dialog>
  )
}
