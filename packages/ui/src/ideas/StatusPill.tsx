import './StatusPill.css'

// Open: draft → requesting review ⇄ changes in progress → approved.
// Closed, with a reason: accepted or rejected.
export type IdeaStatus = 'draft' | 'requesting review' | 'changes in progress' | 'approved' | 'closed'
export type ClosedReason = 'accepted' | 'rejected'

export interface StatusPillProps {
  status: IdeaStatus
  reason?: ClosedReason
  // its team is archived: read only, whatever its status says
  archived?: boolean
}

function key({ status, reason, archived }: StatusPillProps): string {
  if (archived) {
    return 'archived'
  }
  if (status === 'closed') {
    return `closed-${reason ?? 'accepted'}`
  }
  return status.replace(/ /g, '-')
}

function label({ status, reason, archived }: StatusPillProps): string {
  if (archived) {
    return 'Archived'
  }
  if (status === 'closed') {
    return reason ? `Closed · ${reason}` : 'Closed'
  }
  return status[0]?.toUpperCase() + status.slice(1)
}

// An idea's status as a pill: a colored dot and the status in words.
export function StatusPill(props: StatusPillProps) {
  return (
    <span
      className={`status-pill status-${key(props)}`}
      title={props.archived ? `Its team is archived. It was ${props.status} and is now read only.` : undefined}
    >
      <span className="status-dot" aria-hidden />
      {label(props)}
    </span>
  )
}
