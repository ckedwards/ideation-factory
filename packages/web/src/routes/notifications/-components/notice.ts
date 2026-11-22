// A notice about a team or a group, in the inbox's words: what happened, who did it (after their
// name), where it was, where to go to see it, why it's yours, and which section it's in grouped by
// team. Written from the reader's side: "your group" to a group's admin.
import type { NoticeNotification } from '@ideaf/api'
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

const AS: Record<Notice['as'], string> = { 'team-admin': 'Team admin', 'group-admin': 'Group admin', you: 'You' }

export function noticeWords(notice: Notice): NoticeWords {
  const team = notice.team
  const group = notice.group
  const teamName = team?.name ?? 'a team'
  const groupName = group?.name ?? 'a group'
  // a group's admins read "your group"; anyone else its name
  const theGroup = notice.as === 'group-admin' ? 'your group' : groupName
  const teamHref = team?.handle ? `/${team.handle}` : null
  const groupHref = group?.handle ? `/groups/${group.handle}` : null
  // what a notice about you is about: the team, or the group alone
  const container = team ? teamName : groupName
  const kind = team ? 'team' : 'group'
  const base = {
    where: team ? teamName : groupName,
    reason: AS[notice.as],
    section: team
      ? { key: `team:${team.id}`, name: teamName, scope: { team: team.handle ?? team.id } }
      : { key: `group:${group?.id ?? ''}`, name: groupName, scope: { group: group?.handle ?? group?.id ?? '' } },
  }
  switch (notice.kind) {
    case 'group-joined':
      return {
        ...base,
        title: `${groupName} joined ${teamName}${notice.role ? `, as ${notice.role}s` : ''}`,
        update: `added ${theGroup} to ${teamName}`,
        href: groupLink(notice, groupHref, teamHref),
      }
    case 'group-left':
      return {
        ...base,
        title: `${groupName} left ${teamName}`,
        update: `took ${theGroup} out of ${teamName}`,
        href: groupLink(notice, groupHref, teamHref),
      }
    case 'added':
      return {
        ...base,
        title: `You joined ${container}${notice.role ? `, as ${article(notice.role)} ${notice.role}` : ''}`,
        update: `added you to the ${kind}`,
        href: team ? teamHref : groupHref,
      }
    case 'removed':
      return {
        ...base,
        title: `You’re no longer in ${container}`,
        update: `took you out of the ${kind}`,
        href: team ? teamHref : groupHref,
      }
  }
}

/** A group joining or leaving: its admins see it on the group's page, the team's on the team's Groups. */
function groupLink(notice: Notice, group: string | null, team: string | null): string | null {
  return notice.as === 'group-admin' ? group : team ? `${team}/settings?tab=groups` : null
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}
