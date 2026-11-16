import { useId, type ReactNode } from 'react'
import { Highlight } from '../labels/Highlight.tsx'
import { Tag } from '../labels/Tag.tsx'
import { Link } from '../link/Link.tsx'
import { Avatar } from '../people/Avatar.tsx'
import { TeamChip } from '../teams/TeamChip.tsx'
import { RelativeTime } from '../time/RelativeTime.tsx'
import { ApprovalProgress } from './ApprovalProgress.tsx'
import { isClosed, plural, type IdeaInfo } from './idea.ts'
import { ReviewerStack } from './ReviewerStack.tsx'
import { StatusPill } from './StatusPill.tsx'
import './IdeaRow.css'

// What a row can leave out because the page already says it: the team (on
// that team's page) or the author (in a list of your own ideas).
export interface IdeaRowHide {
  team?: boolean
  author?: boolean
}

export interface IdeaRowProps {
  idea: IdeaInfo
  // the search, to highlight in the title, description and author
  query?: string | undefined
  // more facts for the meta line, from the page ("Waiting on you")
  extra?: ReactNode
  hide?: IdeaRowHide
}

// One idea in a list: title and description, team, author and age, and on the
// right its status, how it stands against its requirements, and its reviewers.
export function IdeaRow({ idea, query, extra, hide = {} }: IdeaRowProps) {
  const closed = isClosed(idea)
  const active = !closed && idea.status !== 'draft'
  const title = <Highlight text={idea.title} query={query} />
  const titleId = useId()
  return (
    <article className="idea-row" aria-labelledby={titleId}>
      <div className="idea-row-body">
        <div className="idea-row-main">
          <h3 className="idea-row-title" id={titleId}>
            {idea.href ? <Link href={idea.href}>{title}</Link> : title}
          </h3>
          <p className="idea-row-desc">
            <Highlight text={idea.description} query={query} />
          </p>
          <div className="idea-row-meta">
            {!hide.team && <TeamChip team={idea.team} href={idea.team.href} />}
            {!hide.author && (
              <span className="idea-row-author">
                <Avatar person={idea.author} size="sm" decorative />
                <Highlight text={idea.author.name} query={query} />
                {idea.author.inactive && <Tag tone="dashed">inactive</Tag>}
              </span>
            )}
            <span className="idea-row-age">
              v{idea.version}
              {!closed && (
                <>
                  {' · updated '}
                  <RelativeTime at={idea.updatedAt} />
                </>
              )}
            </span>
            {!hide.team && idea.team.personal && (idea.visibility ?? 'private') === 'private' && (
              <Tag tone="dashed" title="Only the author and people they ask to review can see this">
                <span aria-hidden>🔒</span> Private
              </Tag>
            )}
            {extra}
          </div>
        </div>
        <div className="idea-row-side">
          <StatusPill
            status={idea.status}
            {...(idea.closedReason ? { reason: idea.closedReason } : {})}
            archived={Boolean(idea.archived)}
          />
          {idea.archived ? (
            <span className="idea-row-note">Team archived</span>
          ) : closed ? (
            <span className="idea-row-note">
              Closed <RelativeTime at={idea.updatedAt} />
            </span>
          ) : (
            <>
              {active && (
                <ApprovalProgress
                  approvals={idea.approvals.length}
                  requirements={idea.requirements}
                  teamName={idea.team.name}
                />
              )}
              <span className="idea-row-note">
                {idea.openThreads > 0 ? `${plural(idea.openThreads, 'open thread')}` : 'No open threads'}
              </span>
            </>
          )}
          <ReviewerStack reviewers={idea.reviewers} />
        </div>
      </div>
    </article>
  )
}
