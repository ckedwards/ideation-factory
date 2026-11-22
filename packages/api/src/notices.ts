// A notice about a team or a group in words, the same in the web app, the cli and email: what
// happened, and what its actor did (after their name), from the reader's side ("your group" to a
// group's admin). A team or a group that's gone is named as it was.
import type { NoticeNotification } from './schemas.ts'

type Notice = NoticeNotification['notice']

export interface NoticeText {
  /** "The Design reviewers group joined Mobile, as members". */
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
  const theGroup = notice.as === 'group-admin' ? 'your group' : `the ${group} group`
  // what a notice about you is about: the team, or the group alone, named with which it is ("the Pager
  // group"), as a name alone doesn't say
  const kind = notice.team ? 'team' : 'group'
  const container = notice.team ? team : group
  const named = notice.team ? `the ${team} team` : `the ${group} group`
  const base = { where: container, as: AS[notice.as] }
  switch (notice.kind) {
    // a group only ever joins or leaves a team: the group is named as one, the team needn't be
    case 'group-joined':
      return {
        ...base,
        title: `The ${group} group joined ${team}${notice.role ? `, as ${notice.role}s` : ''}`,
        update: `added ${theGroup} to ${team}`,
      }
    case 'group-left':
      return { ...base, title: `The ${group} group left ${team}`, update: `took ${theGroup} out of ${team}` }
    case 'added':
      return {
        ...base,
        title: `You joined ${named}${notice.role ? `, as ${/^[aeiou]/i.test(notice.role) ? 'an' : 'a'} ${notice.role}` : ''}`,
        update: `added you to the ${kind}`,
      }
    case 'removed':
      return { ...base, title: `You’re no longer in ${named}`, update: `took you out of the ${kind}` }
  }
}
