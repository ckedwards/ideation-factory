// An idea as the idea components show it. Pages map the API's ideas, with
// their team's requirements already checked, onto this.
import type { Person } from '../people/person.ts'
import type { GroupRef } from '../teams/GroupTag.tsx'
import type { TeamRef } from '../teams/TeamChip.tsx'
import type { ClosedReason, IdeaStatus } from './StatusPill.tsx'

// One of the team's approval requirements, checked against this idea.
export interface RequirementCheck {
  text: string
  met: boolean
  // names a deleted group, so a maintainer must fix it before it can be met
  broken?: boolean
  // how far along it is, when not met ("1 so far", "2 open")
  progress?: string
}

export type Reviewer =
  | { kind: 'person'; person: Person }
  | { kind: 'group'; id: string; group: GroupRef; href?: string | undefined }

export interface IdeaInfo {
  id: string
  title: string
  description: string
  // the idea's page
  href?: string | undefined
  team: TeamRef & { href?: string | undefined }
  author: Person
  status: IdeaStatus
  closedReason?: ClosedReason
  // its team is archived: read only, and it counts as closed
  archived?: boolean
  version: number
  // milliseconds since the epoch
  updatedAt: number
  openThreads: number
  // who approved the current version
  approvals: Person[]
  reviewers: Reviewer[]
  // the team's requirements, checked; empty when the team has none
  requirements: RequirementCheck[]
}

// The coarse state: draft, in review (requirements met or not), or closed.
// "In review" covers requesting review and changes in progress; "met" means
// it can be closed as accepted.
export type IdeaStateKey = 'draft' | 'review' | 'met' | 'accepted' | 'rejected' | 'archived'

export function ideaState(idea: Pick<IdeaInfo, 'status' | 'closedReason' | 'archived' | 'requirements'>): IdeaStateKey {
  if (idea.archived) {
    return 'archived'
  }
  if (idea.status === 'closed') {
    return idea.closedReason ?? 'accepted'
  }
  if (idea.status === 'draft') {
    return 'draft'
  }
  const { requirements } = idea
  if (requirements.some((check) => check.broken)) {
    return 'review'
  }
  return requirements.every((check) => check.met) ? 'met' : 'review'
}

export function isClosed(idea: Pick<IdeaInfo, 'status' | 'archived'>): boolean {
  return idea.status === 'closed' || Boolean(idea.archived)
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en')} ${count === 1 ? one : many}`
}
