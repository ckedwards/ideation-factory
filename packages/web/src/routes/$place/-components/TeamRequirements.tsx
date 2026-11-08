// A team's approval requirements, for its maintainers and admins: what an idea
// in the team needs before it can be closed as accepted. A number of
// approvals from people on the latest version, group rules (one approval from
// any of the groups, or one from each, optionally asking the groups to review
// when an idea goes out), and every discussion resolved. They apply at once,
// to ideas already in review too.
import { useState } from 'react'
import { Button, Select, Stack } from '@ideaf/ui'
import { GroupPicker, type GroupRef } from '../../../components/GroupPicker.tsx'
import './TeamPolicies.css'

export interface GroupRuleView {
  mode: 'any' | 'each'
  groups: GroupRef[]
  request: boolean
}

export interface RequirementsView {
  approvals: number
  groups: GroupRuleView[]
  resolved: boolean
}

export interface TeamRequirementsProps {
  requirements: RequirementsView
  onChange: (next: RequirementsView) => void
}

const APPROVALS = Array.from({ length: 11 }, (_, n) => ({
  value: String(n),
  label: n === 0 ? 'No minimum' : n === 1 ? '1 approval' : `${n} approvals`,
}))

const MODES = [
  { value: 'any', label: 'An approval from any of' },
  { value: 'each', label: 'An approval from each of' },
] as const

export function TeamRequirements({ requirements: r, onChange }: TeamRequirementsProps) {
  const [adding, setAdding] = useState<GroupRef | null>(null)
  const setRule = (i: number, rule: GroupRuleView | null) =>
    onChange({
      ...r,
      groups: rule ? r.groups.map((g, j) => (j === i ? rule : g)) : r.groups.filter((_, j) => j !== i),
    })
  return (
    <Stack gap={4}>
      <label className="policy">
        <span>Approvals from people, on the latest version</span>
        <Select
          options={APPROVALS}
          value={String(r.approvals)}
          onChange={(v) => onChange({ ...r, approvals: Number(v) })}
        />
      </label>
      {r.groups.map((rule, i) => (
        <fieldset key={i} className="policy-defaults">
          <legend>Group rule {i + 1}</legend>
          <label className="policy">
            <span>Needs</span>
            <Select options={[...MODES]} value={rule.mode} onChange={(mode) => setRule(i, { ...rule, mode })} />
          </label>
          {rule.groups.map((group) => (
            <div key={group.id} className="policy">
              <span>{group.name}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${group.name} from rule ${i + 1}`}
                onClick={() =>
                  setRule(
                    i,
                    rule.groups.length === 1 ? null : { ...rule, groups: rule.groups.filter((g) => g.id !== group.id) },
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <RuleAdd
            label={`Add a group to rule ${i + 1}`}
            exclude={rule.groups.map((g) => g.id)}
            onAdd={(group) => setRule(i, { ...rule, groups: [...rule.groups, group] })}
          />
          <label className="policy-check">
            <input
              type="checkbox"
              checked={rule.request}
              onChange={(event) => setRule(i, { ...rule, request: event.target.checked })}
            />
            Ask these groups to review when an idea goes out for review
          </label>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setRule(i, null)}>
              Remove this rule
            </Button>
          </div>
        </fieldset>
      ))}
      <form
        className="policy-add"
        onSubmit={(event) => {
          event.preventDefault()
          if (adding) {
            onChange({ ...r, groups: [...r.groups, { mode: 'any', groups: [adding], request: false }] })
            setAdding(null)
          }
        }}
      >
        <div className="policy-add-group">
          <GroupPicker label="A new group rule" value={adding} onChange={setAdding} />
        </div>
        <Button type="submit" disabled={!adding}>
          Add a rule
        </Button>
      </form>
      <label className="policy-check">
        <input
          type="checkbox"
          checked={r.resolved}
          onChange={(event) => onChange({ ...r, resolved: event.target.checked })}
        />
        Every discussion has to be resolved
      </label>
      <p className="policy-note">
        Closing an idea as accepted needs all of these. They apply at once, to ideas already in review too. A bot’s
        approval never counts, and someone in two groups of a rule counts for both.
      </p>
    </Stack>
  )
}

function RuleAdd({ label, exclude, onAdd }: { label: string; exclude: string[]; onAdd: (group: GroupRef) => void }) {
  const [group, setGroup] = useState<GroupRef | null>(null)
  return (
    <div className="policy-add">
      <div className="policy-add-group">
        <GroupPicker label={label} value={group} onChange={setGroup} exclude={exclude} />
      </div>
      <Button
        size="sm"
        disabled={!group}
        onClick={() => {
          if (group) {
            onAdd(group)
            setGroup(null)
          }
        }}
      >
        Add
      </Button>
    </div>
  )
}
