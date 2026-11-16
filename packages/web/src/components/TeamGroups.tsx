// The groups in a team (its settings' Groups tab): each group's members are the team's members, at
// the lower of the group's role here and their own role in it, never admin. Its admins add a group,
// change its role and take it out; taking it out says first who'd leave the team with it.
import { useState } from 'react'
import { Button, Dialog, Link, Select, Stack } from '@ideaf/ui'
import { GroupPicker, type GroupRef } from './GroupPicker.tsx'
import './MemberTable.css'

export type GroupRole = 'member' | 'maintainer'

export interface TeamGroupInfo {
  group: GroupRef & { members: number }
  role: GroupRole
  addedBy: { id: string; handle: string; name: string } | null
  added: number
  /** How many are in the team only through this group. */
  leaving: number
}

const ROLES: { value: GroupRole; label: string }[] = [
  { value: 'member', label: 'Members' },
  { value: 'maintainer', label: 'Maintainers' },
]

const day = (at: number) => new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
const people = (n: number) => (n === 1 ? '1 person' : `${n} people`)

export interface TeamGroupsProps {
  team: { handle: string; name: string }
  groups: TeamGroupInfo[]
  /** Only the team's admins add, change and remove groups. */
  admin: boolean
  onAdd: (group: GroupRef, role: GroupRole) => void
  onRole: (group: GroupRef, role: GroupRole) => void
  onRemove: (group: GroupRef) => void
}

export function TeamGroups({ team, groups, admin, onAdd, onRole, onRemove }: TeamGroupsProps) {
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<TeamGroupInfo | null>(null)
  return (
    <Stack gap={4}>
      <div className="member-toolbar">
        <p className="member-none member-toolbar-search">
          A group’s members are part of the team, as members or maintainers. To share new ideas with a group without
          making it part of the team, use Settings → Its ideas.
        </p>
        {admin && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add a group
          </Button>
        )}
      </div>
      {groups.length === 0 ? (
        <p className="member-none">No groups are part of {team.name}.</p>
      ) : (
        <table className="member-table" aria-label="Groups">
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Its members are</th>
              <th scope="col">Added</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.group.id}>
                <td data-label="Group">
                  <div className="member-account">
                    <Link href={`/groups/${g.group.handle}`}>{g.group.name}</Link>
                    <span className="member-group-size">{people(g.group.members)}</span>
                  </div>
                </td>
                <td data-label="Its members are">
                  {admin ? (
                    <Select
                      size="sm"
                      aria-label={`${g.group.name}’s role`}
                      options={ROLES}
                      value={g.role}
                      onChange={(next) => onRole(g.group, next)}
                    />
                  ) : (
                    <span className="member-row-role">{ROLES.find((r) => r.value === g.role)?.label}</span>
                  )}
                </td>
                <td data-label="Added" className="member-joined">
                  {day(g.added)}
                  {g.addedBy && <> by @{g.addedBy.handle}</>}
                </td>
                <td className="member-actions">
                  {admin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${g.group.name}`}
                      onClick={() => setRemoving(g)}
                    >
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog
        open={removing !== null}
        title={`Take ${removing?.group.name ?? 'the group'} out of ${team.name}?`}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (removing) {
                  onRemove(removing.group)
                }
                setRemoving(null)
              }}
            >
              Take it out
            </Button>
          </>
        }
      >
        <p>
          {removing?.leaving
            ? `${people(removing.leaving)} in ${team.name} only through ${removing.group.name} will leave it, with the access it gave them.`
            : `Everyone in ${removing?.group.name ?? 'it'} is in ${team.name} some other way too, so nobody leaves.`}
        </p>
      </Dialog>
      <AddGroup
        open={adding}
        exclude={groups.map((g) => g.group.id)}
        onClose={() => setAdding(false)}
        onAdd={(group, role) => {
          onAdd(group, role)
          setAdding(false)
        }}
      />
    </Stack>
  )
}

function AddGroup(props: {
  open: boolean
  exclude: string[]
  onClose: () => void
  onAdd: (group: GroupRef, role: GroupRole) => void
}) {
  const [group, setGroup] = useState<GroupRef | null>(null)
  const [role, setRole] = useState<GroupRole>('member')
  const close = () => {
    setGroup(null)
    setRole('member')
    props.onClose()
  }
  return (
    <Dialog
      open={props.open}
      title="Add a group"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!group}
            onClick={() => {
              if (group) {
                props.onAdd(group, role)
                setGroup(null)
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
        <GroupPicker label="Group" value={group} onChange={setGroup} exclude={props.exclude} />
        <Select aria-label="Its members are" options={ROLES} value={role} onChange={setRole} />
        <p className="member-none">
          Its members become the team’s, at most as {role === 'maintainer' ? 'maintainers' : 'members'}: someone who’s a
          plain member of the group stays a member here. Never admins.
        </p>
      </Stack>
    </Dialog>
  )
}
