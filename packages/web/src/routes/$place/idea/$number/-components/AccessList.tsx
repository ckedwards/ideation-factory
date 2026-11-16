// Who can see an idea, and what else they can do: its owner, then each
// grant (a person, a group, a team's members, everyone). Someone with share
// access changes or removes grants, and adds them below.
import type { ReactNode } from 'react'
import { Button, Link, type Person, Select, Stack, UserName } from '@ideaf/ui'
import { type Level, LEVELS, levelOf } from './access.ts'
import './AccessList.css'

export interface GrantRow {
  key: string
  /** Its name; with its kind, said quietly after it. */
  label: string
  kind?: 'user' | 'group' | 'team' | 'everyone'
  href?: string | undefined
  everyone: boolean
  edit: boolean
  share: boolean
}

export interface AccessListProps {
  owner: Person
  grants: GrantRow[]
  /** You can change who has access. */
  canShare: boolean
  onLevel: (grant: GrantRow, level: Level) => void
  onRemove: (grant: GrantRow) => void
  /** Adding a grant (ShareAdder), for someone who can share. */
  adder?: ReactNode
}

export function AccessList({ owner, grants, canShare, onLevel, onRemove, adder }: AccessListProps) {
  return (
    <Stack gap={4}>
      <ul className="access-list" aria-label="Who has access">
        <li className="access-row">
          <UserName person={owner} withAvatar />
          <span className="access-level">owns it: can do anything</span>
        </li>
        {grants.map((grant) => (
          <li key={grant.key} className="access-row">
            <span className="access-who">
              {grant.href ? <Link href={grant.href}>{grant.label}</Link> : <span>{grant.label}</span>}
              {grant.kind && grant.kind !== 'everyone' && (
                <span className="access-kind">
                  {grant.kind === 'user' ? 'person' : grant.kind === 'team' ? 'team' : 'group'}
                </span>
              )}
            </span>
            <span className="access-actions">
              {canShare && !grant.everyone ? (
                <Select
                  size="sm"
                  aria-label={`What ${grant.label} can do`}
                  options={LEVELS}
                  value={levelOf(grant)}
                  onChange={(level) => onLevel(grant, level)}
                />
              ) : (
                <span className="access-level">{LEVELS.find((l) => l.value === levelOf(grant))!.label}</span>
              )}
              {canShare && (
                <Button size="sm" variant="ghost" onClick={() => onRemove(grant)}>
                  Remove
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {grants.length === 0 && <p className="access-note">Only its owner can see it.</p>}
      {canShare && adder}
    </Stack>
  )
}
