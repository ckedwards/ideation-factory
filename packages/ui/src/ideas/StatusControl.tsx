import type { IdeaStatus } from './StatusPill.tsx'
import { StatusPill } from './StatusPill.tsx'
import './StatusControl.css'

// The statuses people move an open idea between. Closing has its own action,
// with a reason.
export type OpenStatus = Exclude<IdeaStatus, 'closed'>

const STATUSES: OpenStatus[] = ['draft', 'requesting review', 'changes in progress']

export interface StatusControlProps {
  value: OpenStatus
  onChange: (status: OpenStatus) => void
  // people with edit access change it; everyone else sees the pill
  canChange?: boolean
}

// An idea's status, as a pill people with edit access can change.
export function StatusControl({ value, onChange, canChange = true }: StatusControlProps) {
  if (!canChange) {
    return <StatusPill status={value} />
  }
  return (
    <label className={`status-control status-${value.replace(/ /g, '-')}`}>
      <span className="status-dot" aria-hidden />
      <select value={value} aria-label="Idea status" onChange={(event) => onChange(event.target.value as OpenStatus)}>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {status[0]?.toUpperCase() + status.slice(1)}
          </option>
        ))}
      </select>
      <span className="status-control-caret" aria-hidden>
        ▾
      </span>
    </label>
  )
}
