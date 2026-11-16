import { Avatar } from '../people/Avatar.tsx'
import { GroupTag } from '../teams/GroupTag.tsx'
import type { Reviewer } from './idea.ts'
import './ReviewerStack.css'

export interface ReviewerStackProps {
  // people and groups asked to review
  reviewers: Reviewer[]
}

// Who's reviewing: people as avatars, groups as tags.
export function ReviewerStack({ reviewers }: ReviewerStackProps) {
  if (reviewers.length === 0) {
    return <span className="reviewers-none">No reviewers yet</span>
  }
  return (
    <span className="reviewers">
      <span className="reviewers-label">Review:</span>
      {reviewers.map((reviewer) =>
        reviewer.kind === 'person' ? (
          <Avatar key={reviewer.person.id} person={reviewer.person} size="sm" />
        ) : (
          <GroupTag key={reviewer.id} group={reviewer.group} href={reviewer.href} />
        ),
      )}
    </span>
  )
}
