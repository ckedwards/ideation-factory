import { Tooltip } from '../overlays/Tooltip.tsx'
import type { RequirementCheck } from './idea.ts'
import { RequirementList } from './RequirementList.tsx'
import { plural } from './idea.ts'
import './ApprovalProgress.css'

export interface ApprovalProgressProps {
  // approvals of the current version
  approvals: number
  // the team's requirements, checked; empty when it has none
  requirements: RequirementCheck[]
  // for the message when the requirements need fixing
  teamName?: string
}

// How an idea stands against its team's approval requirements: "2 of 3
// requirements met", with each one listed in a tooltip.
export function ApprovalProgress({ approvals, requirements, teamName = 'the team' }: ApprovalProgressProps) {
  if (requirements.length === 0) {
    return (
      <Tooltip focusable className="approvals" content="This team has no approval requirements">
        {plural(approvals, 'approval')}
      </Tooltip>
    )
  }
  if (requirements.some((check) => check.broken)) {
    return (
      <Tooltip
        focusable
        className="approvals approvals-broken"
        content={
          <>
            <p className="approvals-note">
              {teamName}’s approval requirements name a deleted group. A maintainer or admin of {teamName} needs to fix
              them before this idea can be closed as accepted.
            </p>
            <RequirementList checks={requirements} />
          </>
        }
      >
        <span aria-hidden>⚠</span> Requirements need fixing
      </Tooltip>
    )
  }
  const met = requirements.filter((check) => check.met).length
  const done = met === requirements.length
  return (
    <Tooltip
      focusable
      className={`approvals${done ? ' approvals-met' : ''}`}
      content={<RequirementList checks={requirements} />}
    >
      {done ? (
        <>
          <span aria-hidden>✓</span> Requirements met
        </>
      ) : (
        `${met} of ${plural(requirements.length, 'requirement')} met`
      )}
    </Tooltip>
  )
}
