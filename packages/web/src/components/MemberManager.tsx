// A team's or a group's members, for someone who can manage them: their
// roles (only admins change them), removing someone (maintainers remove
// members, admins anyone, and anyone can leave), and adding someone.
import { useState } from 'react'
import { Button, type Person, Select, Stack, UserName } from '@ideaf/ui'
import type { MemberInfo } from './MemberList.tsx'
import { PersonPicker } from './PersonPicker.tsx'
import './ContainerList.css'
import './MemberManager.css'

type Role = MemberInfo['role']

const ROLES: { value: Role; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'maintainer', label: 'Maintainer' },
  { value: 'admin', label: 'Admin' },
]

export interface MemberManagerProps {
  members: MemberInfo[]
  /** You, and your role here. */
  you: { id: string; role: Role }
  onRole: (person: Person, role: Role) => void
  onRemove: (person: Person) => void
  onAdd: (person: Person, role: Role) => void
  more?: { loading: boolean; onMore: () => void } | null
}

export function MemberManager({ members, you, onRole, onRemove, onAdd, more }: MemberManagerProps) {
  const [adding, setAdding] = useState<Person | null>(null)
  const [role, setRole] = useState<Role>('member')
  const admin = you.role === 'admin'
  const removable = (member: MemberInfo) =>
    member.person.id === you.id || admin || (you.role === 'maintainer' && member.role === 'member')

  return (
    <Stack gap={4}>
      <ul className="container-list" aria-label="Members">
        {members.map((member) => (
          <li key={member.person.id} className="container-row member-row">
            <UserName person={member.person} withAvatar />
            <span className="member-row-actions">
              {admin ? (
                <Select
                  size="sm"
                  aria-label={`${member.person.name}’s role`}
                  options={ROLES}
                  value={member.role}
                  onChange={(next) => onRole(member.person, next)}
                />
              ) : (
                <span className="member-row-role">{member.role}</span>
              )}
              {removable(member) && (
                <Button size="sm" variant="ghost" onClick={() => onRemove(member.person)}>
                  {member.person.id === you.id ? 'Leave' : 'Remove'}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {more && (
        <div>
          <Button variant="ghost" onClick={more.onMore} disabled={more.loading}>
            {more.loading ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
      <form
        className="member-add"
        onSubmit={(event) => {
          event.preventDefault()
          if (adding) {
            onAdd(adding, role)
            setAdding(null)
            setRole('member')
          }
        }}
      >
        <div className="member-add-person">
          <PersonPicker
            label="Add someone"
            value={adding}
            onChange={setAdding}
            exclude={members.map((m) => m.person.id)}
          />
        </div>
        {admin && <Select aria-label="As" options={ROLES} value={role} onChange={setRole} />}
        <Button type="submit" variant="primary" disabled={!adding}>
          Add
        </Button>
      </form>
    </Stack>
  )
}
