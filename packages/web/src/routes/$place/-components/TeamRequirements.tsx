// A team's approval requirements, for its maintainers and admins: what an idea
// in the team needs before it can be closed as accepted. A number of
// approvals from people on the latest version, group rules (one approval from
// any of the groups, or one from each, optionally asking the groups to review
// when an idea goes out), and every discussion resolved. Changes are a draft
// (RequirementsDraft), saying what they'll need, until they're saved: then
// they apply at once, to ideas already in review too.
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
        // the rule as a sentence: "One approval from any of [Security ×] or [Legal ×]  [+ group]"
        <div key={i} className="policy-rule" role="group" aria-label={`Group rule ${i + 1}`}>
          <p className="policy-rule-sentence">
            <span>One approval from</span>
            {rule.groups.length > 1 ? (
              <Select
                size="sm"
                aria-label="Needs"
                options={[
                  { value: 'any', label: 'any of' },
                  { value: 'each', label: 'each of' },
                ]}
                value={rule.mode}
                onChange={(mode) => setRule(i, { ...rule, mode })}
              />
            ) : null}
            {rule.groups.map((group, j) => (
              <span key={group.id} className="policy-rule-group">
                {j > 0 && <span className="policy-rule-join">{rule.mode === 'each' ? 'and' : 'or'}</span>}
                <span className="policy-chip">
                  {group.name}
                  <button
                    type="button"
                    aria-label={`Remove ${group.name} from rule ${i + 1}`}
                    onClick={() =>
                      setRule(
                        i,
                        rule.groups.length === 1
                          ? null
                          : { ...rule, groups: rule.groups.filter((g) => g.id !== group.id) },
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              </span>
            ))}
          </p>
          <RuleAdd
            label={`Add a group to rule ${i + 1}`}
            exclude={rule.groups.map((g) => g.id)}
            onAdd={(group) => setRule(i, { ...rule, groups: [...rule.groups, group] })}
          />
          <div className="policy-rule-foot">
            <label className="policy-check">
              <input
                type="checkbox"
                checked={rule.request}
                onChange={(event) => setRule(i, { ...rule, request: event.target.checked })}
              />
              Ask {rule.groups.length === 1 ? 'it' : 'them'} to review when an idea goes out for review
            </label>
            <Button size="sm" variant="ghost" onClick={() => setRule(i, null)}>
              Remove this rule
            </Button>
          </div>
        </div>
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
        Closing an idea as accepted needs all of these. Once saved, they apply at once, to ideas already in review too.
        A bot’s approval never counts, and someone in two groups of a rule counts for both.
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

const each = (names: string[], word: 'or' | 'and') =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${word} ${names.at(-1)}`

/** What the requirements need of an idea, in a sentence: as they stand (now), or once saved. */
export function requirementsSentence(r: RequirementsView, now = false): string {
  const parts = [
    ...(r.approvals > 0
      ? [r.approvals === 1 ? '1 approval from a person' : `${r.approvals} approvals from people`]
      : []),
    ...r.groups
      .filter((rule) => rule.groups.length > 0)
      .map((rule) =>
        rule.mode === 'each' && rule.groups.length > 1
          ? `an approval from each of ${each(
              rule.groups.map((g) => g.name),
              'and',
            )}`
          : `an approval from ${each(
              rule.groups.map((g) => g.name),
              'or',
            )}`,
      ),
    ...(r.resolved ? ['every discussion resolved'] : []),
  ]
  return parts.length === 0
    ? 'Ideas can be closed as accepted with no approvals.'
    : `Closing an idea as accepted ${now ? 'needs' : 'will need'} ${each(parts, 'and')}.`
}

export interface RequirementsDraftProps {
  saved: RequirementsView
  onSave: (next: RequirementsView) => Promise<unknown>
}

/** The requirements as a draft: what it'll need is said, and nothing changes until Save. */
export function RequirementsDraft({ saved, onSave }: RequirementsDraftProps) {
  const key = JSON.stringify(saved)
  const [draft, setDraft] = useState(saved)
  const [base, setBase] = useState(key)
  const [saving, setSaving] = useState(false)
  // saved elsewhere, or just now: the draft starts again from it
  if (key !== base) {
    setBase(key)
    setDraft(saved)
  }
  const changed = JSON.stringify(draft) !== key
  return (
    <div className="policy-form">
      <Stack gap={4}>
        <TeamRequirements requirements={draft} onChange={setDraft} />
        <p className="policy-summary" aria-live="polite">
          {requirementsSentence(draft)}
        </p>
        {/* Save is there from the start, so it's plain changes need saving; it works once there are some */}
        <div className="policy-save">
          {changed && (
            <Button variant="ghost" onClick={() => setDraft(saved)} disabled={saving}>
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            disabled={saving || !changed}
            onClick={() => {
              setSaving(true)
              void onSave(draft).finally(() => setSaving(false))
            }}
          >
            {saving ? 'Saving…' : 'Save requirements'}
          </Button>
        </div>
      </Stack>
    </div>
  )
}
