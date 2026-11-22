/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { noticeWords } from './notice.ts'

const team = { id: 't1', handle: 'mobile', name: 'Mobile' }
const group = { id: 'g1', handle: 'design-reviewers', name: 'Design reviewers' }
const actor = { user: 'u-jordan', bot: null, purpose: 'me' as const }

test('a group joining a team: "your group" to its admins, its name to the team’s, each linked to their side', () => {
  const notice = { kind: 'group-joined' as const, team, group, role: 'member', actor }
  expect(noticeWords({ ...notice, as: 'group-admin' })).toMatchObject({
    title: 'Design reviewers joined Mobile, as members',
    update: 'added your group to Mobile',
    where: 'Mobile',
    href: '/groups/design-reviewers',
    reason: 'Group admin',
    section: { key: 'team:t1', name: 'Mobile', scope: { team: 'mobile' } },
  })
  expect(noticeWords({ ...notice, as: 'team-admin' })).toMatchObject({
    update: 'added Design reviewers to Mobile',
    href: '/mobile/settings?tab=groups',
    reason: 'Team admin',
  })
})

test('a group leaving a team', () => {
  expect(noticeWords({ kind: 'group-left', team, group, role: null, as: 'team-admin', actor })).toMatchObject({
    title: 'Design reviewers left Mobile',
    update: 'took Design reviewers out of Mobile',
  })
})

test('you, added to a team or taken out of a group alone: the group’s own section', () => {
  expect(noticeWords({ kind: 'added', team, group: null, role: 'admin', as: 'you', actor })).toMatchObject({
    title: 'You joined Mobile, as an admin',
    update: 'added you to the team',
    href: '/mobile',
    reason: 'You',
  })
  expect(noticeWords({ kind: 'removed', team: null, group, role: null, as: 'you', actor })).toMatchObject({
    title: 'You’re no longer in Design reviewers',
    update: 'took you out of the group',
    where: 'Design reviewers',
    href: '/groups/design-reviewers',
    section: { key: 'group:g1', name: 'Design reviewers', scope: { group: 'design-reviewers' } },
  })
})

test('a team that’s gone: named as it was, with nothing to link to', () => {
  const gone = { id: 't9', handle: null, name: 'Old team' }
  expect(noticeWords({ kind: 'removed', team: gone, group: null, role: null, as: 'you', actor })).toMatchObject({
    title: 'You’re no longer in Old team',
    href: null,
    section: { scope: { team: 't9' } },
  })
})
