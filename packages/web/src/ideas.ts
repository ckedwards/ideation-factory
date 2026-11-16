// An idea from a list (list_ideas, search_ideas) as ui's IdeaRow shows it:
// linked to its address, its team linked to the team's page, or marked as
// someone's own. Reviews and requirements come with step 9; until then a row
// has none.
import { type IdeaStatus as ApiStatus, type Operations, type Output, ideaPath } from '@ideaf/api'
import type { ClosedReason, IdeaInfo, IdeaStatus } from '@ideaf/ui'

export type ListedIdea = Output<Operations['listIdeas']>['items'][number]

/** An idea's status as ui shows it: its words, and why it closed. */
export type ShownStatus = { status: IdeaStatus; reason?: ClosedReason }

const SHOWN: Record<ApiStatus, ShownStatus> = {
  draft: { status: 'draft' },
  'requesting-review': { status: 'requesting review' },
  'changes-in-progress': { status: 'changes in progress' },
  'closed-accepted': { status: 'closed', reason: 'accepted' },
  'closed-rejected': { status: 'closed', reason: 'rejected' },
}

/** An idea's status as ui shows it; one it doesn't know reads as a draft. */
export function statusOf(status: string): ShownStatus {
  return SHOWN[status as ApiStatus] ?? SHOWN.draft
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
    status: statusOf(row.status).status,
    ...(statusOf(row.status).reason ? { closedReason: statusOf(row.status).reason! } : {}),
    ...(row.team?.archived ? { archived: true } : {}),
    version: row.latest,
    updatedAt: row.updatedAt,
    openThreads: row.openComments,
    approvals: row.approvals.map((p) => ({ id: p.id, name: p.name, handle: p.handle, inactive: p.inactive })),
    reviewers: row.reviewers.map((r) =>
      r.kind === 'user'
        ? {
            kind: 'person' as const,
            person: { id: r.user.id, name: r.user.name, handle: r.user.handle, inactive: r.user.inactive },
          }
        : {
            kind: 'group' as const,
            id: r.group.id,
            group: { name: r.group.name },
            href: `/groups/${r.group.handle}`,
          },
    ),
    visibility: row.visibility,
    // lists don't check the team's requirements: approvals show as a count
    requirements: [],
  }
}
