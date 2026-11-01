import { Link } from '../link/Link.tsx'
import './TeamChip.css'

export interface TeamRef {
  name: string
  // only its members can see its ideas
  locked?: boolean
  // someone's own ideas, in no team ("Your ideas", "Riley Park's ideas")
  personal?: boolean
  // read only: no new ideas, and its ideas count as closed
  archived?: boolean
}

export interface TeamChipProps {
  team: TeamRef
  // the team's page
  href?: string | undefined
}

function describe(team: TeamRef): string | undefined {
  if (team.personal) {
    return 'Not in any team. Private.'
  }
  const facts = [
    team.locked && 'Locked team: only its members can see its ideas',
    team.archived && 'Archived: read only',
  ]
  return facts.filter(Boolean).join('. ') || undefined
}

// The team an idea belongs to, as a small chip that links to the team.
export function TeamChip({ team, href }: TeamChipProps) {
  const className = [
    'team-chip',
    (team.personal || team.locked) && 'team-chip-private',
    team.archived && 'team-chip-archived',
  ]
    .filter(Boolean)
    .join(' ')
  const content = (
    <>
      {(team.personal || team.locked) && (
        <>
          <span aria-hidden>🔒 </span>
          <span className="visually-hidden">{team.personal ? 'Private: ' : 'Locked team: '}</span>
        </>
      )}
      {team.name}
      {team.archived && <span className="team-chip-note"> · archived</span>}
    </>
  )
  if (href) {
    return (
      <Link href={href} className={className} title={describe(team)}>
        {content}
      </Link>
    )
  }
  return (
    <span className={className} title={describe(team)}>
      {content}
    </span>
  )
}
