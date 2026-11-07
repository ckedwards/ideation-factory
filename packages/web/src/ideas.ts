// An idea from a list (list_ideas, search_ideas) as ui's IdeaRow shows it:
// linked to its address, its team linked to the team's page, or marked as
// someone's own. Reviews and requirements come with step 9; until then a row
// has none.
import { type Operations, type Output, ideaPath } from '@ideaf/api'
import type { IdeaInfo, IdeaStatus } from '@ideaf/ui'

export type ListedIdea = Output<Operations['listIdeas']>['items'][number]

const STATUSES: readonly IdeaStatus[] = ['draft', 'requesting review', 'changes in progress', 'approved', 'closed']

/** An idea's status as ui shows it; one it doesn't know reads as a draft. */
export function statusOf(status: string): IdeaStatus {
  return STATUSES.includes(status as IdeaStatus) ? (status as IdeaStatus) : 'draft'
}

export function ideaInfo(row: ListedIdea, me: string): IdeaInfo {
  const author = { id: row.owner.id, name: row.owner.name, handle: row.owner.handle, inactive: row.owner.inactive }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    href: ideaPath(row.place, row.number),
    team: row.team
      ? { name: row.team.name, archived: row.team.archived, href: `/${row.team.handle}` }
      : {
          name: row.owner.id === me ? 'Your ideas' : `${row.owner.name}’s ideas`,
          personal: true,
          href: `/@${row.owner.handle}`,
        },
    author,
    status: statusOf(row.status),
    ...(row.team?.archived ? { archived: true } : {}),
    version: row.latest,
    updatedAt: row.updatedAt,
    openThreads: row.openComments,
    approvals: [],
    reviewers: [],
    requirements: [],
  }
}
