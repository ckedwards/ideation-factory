// Where a group is used in teams' approval requirements: each rule that names it, as a sentence.
import { Link } from '@ideaf/ui'
import './GroupRules.css'

export interface GroupRule {
  team: { id: string; handle: string; name: string }
  mode: 'any' | 'each'
  request: boolean
  groups: Array<{ id: string; handle: string; name: string }>
}

export function GroupRules({ group, rules }: { group: { name: string }; rules: GroupRule[] }) {
  if (rules.length === 0) {
    return <p className="member-none">No team’s approval requirements name {group.name}.</p>
  }
  return (
    <ul className="group-rules">
      {rules.map((rule, i) => (
        <li key={`${rule.team.id}-${i}`}>
          <Link href={`/${rule.team.handle}`}>{rule.team.name}</Link>: closing an idea as accepted needs an approval
          from {rule.mode === 'each' && rule.groups.length > 1 ? 'each of' : 'any of'}{' '}
          {rule.groups.map((g, j) => (
            <span key={g.id}>
              {j > 0 && (j === rule.groups.length - 1 ? (rule.mode === 'each' ? ' and ' : ' or ') : ', ')}
              {g.name}
            </span>
          ))}
          {rule.request && <span className="group-rules-note"> · they’re asked to review when an idea goes out</span>}
        </li>
      ))}
    </ul>
  )
}
