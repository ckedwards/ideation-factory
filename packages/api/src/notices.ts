// A notice about a team or a group in words, the same in the web app, the cli and email: what
// happened, and what its actor did (after their name), from the reader's side ("your group" to a
// group's admin). A team or a group that's gone is named as it was.
import type { NoticeNotification } from './schemas.ts'

type Notice = NoticeNotification['notice']

export interface NoticeText {
  /** "Design reviewers joined Mobile, as members". */
  title: string
  /** After who did it: "added your group to Mobile". */
  update: string
  /** Its team, or its group when it's about a group alone. */
  where: string
  /** Why it's yours: "Group admin", "Team admin" or "You". */
  as: string
}

const AS: Record<Notice['as'], string> = { 'team-admin': 'Team admin', 'group-admin': 'Group admin', you: 'You' }

export function noticeText(notice: Notice): NoticeText {
  const team = notice.team?.name ?? 'a team'
  const group = notice.group?.name ?? 'a group'
  // a group's admins read "your group"; anyone else its name
  const theGroup = notice.as === 'group-admin' ? 'your group' : group
  // what a notice about you is about: the team, or the group alone
  const container = notice.team ? team : group
  const kind = notice.team ? 'team' : 'group'
  const base = { where: container, as: AS[notice.as] }
  switch (notice.kind) {
    case 'group-joined':
      return {
        ...base,
        title: `${group} joined ${team}${notice.role ? `, as ${notice.role}s` : ''}`,
        update: `added ${theGroup} to ${team}`,
      }
    case 'group-left':
      return { ...base, title: `${group} left ${team}`, update: `took ${theGroup} out of ${team}` }
    case 'added':
      return {
        ...base,
        title: `You joined ${container}${notice.role ? `, as ${/^[aeiou]/i.test(notice.role) ? 'an' : 'a'} ${notice.role}` : ''}`,
        update: `added you to the ${kind}`,
      }
    case 'removed':
      return { ...base, title: `You’re no longer in ${container}`, update: `took you out of the ${kind}` }
  }
}
