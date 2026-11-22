// A notice about a team or a group, in the inbox's words: what happened, who did it (after their
// name), where it was, where to go to see it, why it's yours, and which section it's in grouped by
// team. Written from the reader's side: "your group" to a group's admin.
import { type NoticeNotification, noticeText } from '@ideaf/api'
import type { InboxSection } from './InboxList.tsx'

type Notice = NoticeNotification['notice']

export interface NoticeWords {
  title: string
  /** After who did it: "added your group to Mobile". */
  update: string
  /** Its team, or its group when it's about a group alone. */
  where: string
  /** Where it's seen: the group's page for its admins, the team's Groups for the team's; null once it's gone. */
  href: string | null
  /** Why it's yours. */
  reason: string
  section: InboxSection
}

export function noticeWords(notice: Notice): NoticeWords {
  const team = notice.team
  const group = notice.group
  const text = noticeText(notice)
  const teamHref = team?.handle ? `/${team.handle}` : null
  const groupHref = group?.handle ? `/groups/${group.handle}` : null
  const joining = notice.kind === 'group-joined' || notice.kind === 'group-left'
  return {
    title: text.title,
    update: text.update,
    where: text.where,
    reason: text.as,
    // a group joining or leaving: seen on its side; a notice about you: the team or the group
    href: joining ? groupLink(notice, groupHref, teamHref) : team ? teamHref : groupHref,
    section: team
      ? { key: `team:${team.id}`, name: text.where, scope: { team: team.handle ?? team.id } }
      : {
          key: `group:${group?.id ?? ''}`,
          name: text.where,
          scope: { group: group?.handle ?? group?.id ?? '' },
          group: true,
        },
  }
}

/** A group joining or leaving: its admins see it on the group's page, the team's on the team's Groups. */
function groupLink(notice: Notice, group: string | null, team: string | null): string | null {
  return notice.as === 'group-admin' ? group : team ? `${team}/settings?tab=groups` : null
}
