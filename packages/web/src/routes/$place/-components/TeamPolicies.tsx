// A team's rules for its ideas, for its admins: who can start one, and what
// access a new one starts with (its members', everyone's, and groups').
// Ideas already in the team keep the access they have.
import { useState } from 'react'
import { Button, Select, Stack } from '@ideaf/ui'
import { GroupPicker, type GroupRef } from '../../../components/GroupPicker.tsx'
import './TeamPolicies.css'

export type CreatePolicy = 'anyone' | 'members' | 'maintainers'

export interface TeamDefaults {
  members: 'none' | 'view' | 'edit'
  public: boolean
  groups: { group: GroupRef; edit: boolean }[]
}

export interface TeamPoliciesProps {
  createPolicy: CreatePolicy
  defaults: TeamDefaults
  onCreatePolicy: (policy: CreatePolicy) => void
  onDefaults: (defaults: TeamDefaults) => void
}

const WHO: { value: CreatePolicy; label: string }[] = [
  { value: 'members', label: 'Its members' },
  { value: 'maintainers', label: 'Its maintainers and admins' },
  { value: 'anyone', label: 'Anyone' },
]
const MEMBERS: { value: TeamDefaults['members']; label: string }[] = [
  { value: 'view', label: 'can view and comment' },
  { value: 'edit', label: 'can edit' },
  { value: 'none', label: 'can’t see it until shared' },
]
const ACCESS = [
  { value: 'view', label: 'can view and comment' },
  { value: 'edit', label: 'can edit' },
] as const

export function TeamPolicies({ createPolicy, defaults, onCreatePolicy, onDefaults }: TeamPoliciesProps) {
  const [adding, setAdding] = useState<GroupRef | null>(null)
  return (
    <Stack gap={4}>
      <label className="policy">
        <span>Who can start an idea in it</span>
        <Select options={WHO} value={createPolicy} onChange={onCreatePolicy} />
      </label>
      <fieldset className="policy-defaults">
        <legend>A new idea starts with</legend>
        <label className="policy">
          <span>The team’s members</span>
          <Select
            options={MEMBERS}
            value={defaults.members}
            onChange={(members) => onDefaults({ ...defaults, members })}
          />
        </label>
        <label className="policy">
          <span>Everyone on the site</span>
          <Select
            options={[
              { value: 'no', label: 'can’t see it' },
              { value: 'yes', label: 'can view and comment' },
            ]}
            value={defaults.public ? 'yes' : 'no'}
            onChange={(v) => onDefaults({ ...defaults, public: v === 'yes' })}
          />
        </label>
        <p className="policy-note">
          <strong>Also shared with:</strong> groups that see each new idea without joining the team, and can be taken
          off any one idea. To make a group part of the team, add it on the Groups tab.
        </p>
        {defaults.groups.map(({ group, edit }) => (
          <div key={group.id} className="policy">
            <span>{group.name}</span>
            <span className="policy-group">
              <Select
                aria-label={`${group.name}’s access`}
                options={[...ACCESS]}
                value={edit ? 'edit' : 'view'}
                onChange={(v) =>
                  onDefaults({
                    ...defaults,
                    groups: defaults.groups.map((g) => (g.group.id === group.id ? { group, edit: v === 'edit' } : g)),
                  })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onDefaults({ ...defaults, groups: defaults.groups.filter((g) => g.group.id !== group.id) })
                }
              >
                Remove
              </Button>
            </span>
          </div>
        ))}
        <form
          className="policy-add"
          onSubmit={(event) => {
            event.preventDefault()
            if (adding) {
              onDefaults({ ...defaults, groups: [...defaults.groups, { group: adding, edit: false }] })
              setAdding(null)
            }
          }}
        >
          <div className="policy-add-group">
            <GroupPicker
              label="Add a group"
              value={adding}
              onChange={setAdding}
              exclude={defaults.groups.map((g) => g.group.id)}
            />
          </div>
          <Button type="submit" disabled={!adding}>
            Add
          </Button>
        </form>
      </fieldset>
      <p className="policy-note">Ideas already in the team keep the access they have.</p>
    </Stack>
  )
}
