import type { ReactNode } from 'react'
import { type TeamRef, TeamChip } from '../teams/TeamChip.tsx'
import './IdeaHeading.css'

export interface IdeaHeadingProps {
  title: string
  team: TeamRef & { href?: string | undefined }
  // the idea's status: a StatusControl for someone who can change it, a
  // StatusPill otherwise
  status: ReactNode
  // a line under it: the version shown and who wrote it
  meta?: ReactNode
  // when the title is clicked: the page opens the idea's details
  onTitleClick?: () => void
}

// The idea, at the top of the idea page's left pane: its title, its team, its
// status, and the version shown.
export function IdeaHeading({ title, team, status, meta, onTitleClick }: IdeaHeadingProps) {
  return (
    <header className="idea-heading">
      <h1 className="idea-heading-title">
        {onTitleClick ? (
          <button type="button" className="idea-heading-button" onClick={onTitleClick} title="Show the details">
            {title}
          </button>
        ) : (
          title
        )}
      </h1>
      <div className="idea-heading-row">
        <TeamChip team={team} href={team.href} />
        {status}
      </div>
      {meta && <p className="idea-heading-meta">{meta}</p>}
    </header>
  )
}
