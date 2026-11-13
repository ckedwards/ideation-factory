// open_idea, an idea's page in one read: the same as each separate read gives,
// and refused like them to someone who can't see the idea.
import { beforeAll, expect, test } from 'bun:test'
import { api, server } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`

test("an idea's page in one read is what each read gives on its own", async () => {
  const riley = api(h('riley'))
  await api(h('maya')).me({})
  const team = await riley.createTeam({ handle: h('core'), name: 'Core' })
  await riley.addTeamMember({ team: team.id, user: h('maya'), role: 'member' })
  const { idea } = await riley.createIdea({
    title: 'Offline sync',
    team: team.handle,
    files: [{ path: 'plan.md', content: '# Plan\n\nQueue changes.\n\n## Risks\n\nConflicts.\n' }],
  })
  const maya = api(h('maya'))
  await maya.addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'What about conflicts?' })
  await riley.setReviewer({ idea, subject: { kind: 'user', id: h('maya') }, reviewer: true })

  const page = await maya.openIdea({ idea })
  expect(page.idea).toEqual(await maya.getIdea({ idea }))
  expect(page.files).toEqual(await maya.pull({ idea }))
  expect(page.outline).toEqual(await maya.showBlocks({ idea }))
  expect(page.comments).toEqual(await maya.listComments({ idea }))
  expect(page.reviews).toEqual(await maya.listReviews({ idea }))
  expect(page.subscription).toEqual(await maya.getSubscription({ idea }))
  expect(page.team).toEqual(await maya.getTeam({ team: team.id }))
  // and at an earlier version
  expect((await maya.openIdea({ idea, version: 1 })).files).toEqual(await maya.pull({ idea, version: 1 }))

  // someone outside the team gets what get_idea gives them: not found
  const outsider = api(h('outsider'))
  await expect(outsider.openIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
  await expect(outsider.getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
})
