/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { ideaInfo, type ListedIdea } from './ideas.ts'

const row = (extra: Partial<ListedIdea> = {}): ListedIdea => ({
  id: 'i1',
  title: 'Offline sync',
  description: 'Queue changes.',
  status: 'draft',
  latest: 3,
  createdAt: 1,
  updatedAt: 2,
  place: 'mobile',
  number: 9,
  openComments: 2,
  team: { id: 't1', handle: 'mobile', name: 'Mobile', archived: false },
  owner: { id: 'u-riley', handle: 'riley', name: 'Riley Park', inactive: false },
  ...extra,
})

test("a team's idea links to its address, and its team to the team's page", () => {
  expect(ideaInfo(row(), 'u-me')).toMatchObject({
    href: '/mobile/idea/9',
    team: { name: 'Mobile', href: '/mobile' },
    author: { name: 'Riley Park', handle: 'riley' },
    version: 3,
    openThreads: 2,
    reviewers: [],
  })
})

test("someone's own idea: yours, or theirs, linked to their page", () => {
  const own = row({ team: null, place: '@riley', number: 3 })
  expect(ideaInfo(own, 'u-riley')).toMatchObject({
    href: '/@riley/idea/3',
    team: { name: 'Your ideas', personal: true, href: '/@riley' },
  })
  expect(ideaInfo(own, 'u-me').team.name).toBe('Riley Park’s ideas')
})

test("an archived team's idea, and a status ui doesn't know", () => {
  expect(ideaInfo(row({ team: { id: 't1', handle: 'old', name: 'Old', archived: true } }), 'u-me').archived).toBe(true)
  expect(ideaInfo(row({ status: 'something new' as never }), 'u-me').status).toBe('draft')
  expect(ideaInfo(row({ status: 'closed-rejected' }), 'u-me')).toMatchObject({
    status: 'closed',
    closedReason: 'rejected',
  })
})
