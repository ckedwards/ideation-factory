// Step 5 end to end, through the typed client with several people: private
// ideas, team defaults, access that follows membership, sharing, lists and
// search (with index rows kept current by the idea actors), joining by request,
// and the move wizard.
import { beforeAll, describe, expect, test } from 'bun:test'
import { createApiClient } from '@ideaf/api'
import { createApp } from './app.ts'
import { signIn, startTestActors, TEST_URL, testAuth } from './testing.ts'

let app: (request: Request) => Promise<Response>
beforeAll(async () => {
  app = createApp({ actors: await startTestActors(), auth: testAuth, validateOutput: true })
}, 60_000)

// each test run uses fresh handles, so tests never collide
const run = crypto.randomUUID().slice(0, 6)
const handle = (name: string) => `${name}-${run}`
const as = (name: string) =>
  createApiClient({
    baseUrl: TEST_URL,
    token: async () => (await signIn(app, handle(name))).jwt,
    fetch: (r) => app(r),
    validateOutput: true,
  })

const PLAN = '# Plan\n\nThe quick brown fox.\n'

async function eventually<T>(fn: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await fn()
  for (let i = 0; i < 60 && !done(value); i++) {
    await new Promise((r) => setTimeout(r, 50))
    value = await fn()
  }
  return value
}

describe('ideas outside a team', () => {
  test('are private to their owner until shared', async () => {
    const riley = as('riley')
    const maya = as('maya')
    await maya.me({})
    const { idea } = await riley.createIdea({ title: 'Private plan', files: [{ path: 'a.md', content: PLAN }] })
    // someone without access can't tell it exists
    await expect(maya.getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      maya.addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'hi' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect((await maya.listIdeas({})).items.some((i) => i.id === idea)).toBe(false)

    // share it for viewing: maya can read and comment, but not edit
    await riley.setAccess({
      idea,
      subject: { kind: 'user', id: handle('maya') },
      access: { edit: false, share: false },
    })
    expect((await maya.getAccess({ idea })).you).toEqual({ view: true, edit: false, share: false, owner: false })
    await maya.addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Looks good' })
    await expect(
      maya.edit({ idea, batch: { base: 1, steps: [{ command: 'delete', target: 'b3' }] } }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await expect(
      maya.setAccess({ idea, subject: { kind: 'everyone' }, access: { edit: false, share: false } }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    // give edit: now maya can edit
    await riley.setAccess({ idea, subject: { kind: 'user', id: handle('maya') }, access: { edit: true, share: false } })
    expect(
      (
        await maya.edit({
          idea,
          batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'brown', new: 'red' }] },
        })
      ).version,
    ).toBe(2)
  })
})

describe('suggested edits', () => {
  test('anyone who can view suggests; people with edit access accept or reject', async () => {
    const riley = as('riley')
    const maya = as('maya')
    await maya.me({})
    const { idea } = await riley.createIdea({ title: 'Suggested', files: [{ path: 'a.md', content: PLAN }] })
    await riley.setAccess({
      idea,
      subject: { kind: 'user', id: handle('maya') },
      access: { edit: false, share: false },
    })

    // "quick brown" is plain text 9–20
    const anchor = { kind: 'text' as const, file: 'f1', start: 9, end: 20 }
    expect(await maya.suggestionSource({ idea, file: 'f1', start: 9, end: 20 })).toEqual({
      version: 1,
      old: 'quick brown',
    })
    const { comment, old } = await maya.suggestEdit({ idea, version: 1, anchor, new: 'slow red' })
    expect(old).toBe('quick brown')
    await expect(maya.acceptSuggestions({ idea, suggestions: [comment] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(maya.rejectSuggestion({ idea, comment })).rejects.toMatchObject({ code: 'forbidden' })

    // into the draft: committing it makes the version
    const accepted = await riley.acceptSuggestions({ idea, suggestions: [comment] })
    expect(accepted).toEqual({ accepted: [comment], skipped: [] })
    expect(await riley.commitDraft({ idea })).toMatchObject({ version: 2 })
    expect((await riley.pull({ idea })).files[0]!.content).toBe('# Plan\n\nThe slow red fox.\n')
    const [thread] = await maya.listComments({ idea })
    expect(thread).toMatchObject({ resolved: true, suggestion: { decision: { kind: 'accepted', version: 2 } } })
  })
})

describe('ideas in a team', () => {
  test("start with the team's defaults, and access follows membership", async () => {
    const riley = as('riley')
    const sam = as('sam')
    await sam.me({})
    const team = await riley.createTeam({ handle: handle('core'), name: 'Core' })
    expect(team).toMatchObject({ members: 1, createPolicy: 'members', defaults: { members: 'view', public: false } })

    // only members can create ideas in it
    await expect(
      sam.createIdea({ title: 'Not mine to make', team: team.handle, files: [{ path: 'a.md', content: PLAN }] }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const { idea } = await riley.createIdea({
      title: 'Team plan',
      team: team.handle,
      files: [{ path: 'a.md', content: PLAN }],
    })
    expect((await riley.getAccess({ idea })).grants).toEqual([
      { subject: { kind: 'team', id: team.id }, edit: false, share: false, reviewer: false },
    ])
    await expect(sam.getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
    // the idea says which team it's in, and what you can do with it
    expect(await riley.getIdea({ idea })).toMatchObject({
      team: team.id,
      you: { view: true, edit: true, share: true, owner: true },
    })

    // joining is by request; once approved, sam can view the team's ideas
    expect(await sam.requestToJoinTeam({ team: team.handle })).toEqual({ requested: true })
    expect((await riley.listTeamJoinRequests({ team: team.handle })).items.map((u) => u.handle)).toEqual([
      handle('sam'),
    ])
    await riley.decideTeamJoinRequest({ team: team.handle, user: handle('sam'), approve: true })
    expect((await sam.getIdea({ idea })).title).toBe('Team plan')
    expect((await sam.listIdeas({ team: team.handle })).items.map((i) => i.id)).toEqual([idea])

    // leaving the team takes the access away at once
    await sam.removeTeamMember({ team: team.handle, user: handle('sam') })
    await expect(sam.getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
  })

  test('groups can be given access too, and team settings change what new ideas start with', async () => {
    const riley = as('riley')
    const devon = as('devon')
    await devon.me({})
    const security = await devon.createGroup({ handle: handle('security'), name: 'Security' })
    const team = await riley.createTeam({ handle: handle('infra'), name: 'Infra' })
    await riley.updateTeam({
      team: team.handle,
      defaults: { members: 'edit', public: false, groups: [{ group: security.id, edit: false }] },
    })
    const { idea } = await riley.createIdea({
      title: 'Infra plan',
      team: team.id,
      files: [{ path: 'a.md', content: PLAN }],
    })
    expect((await riley.getAccess({ idea })).grants.map((g) => [g.subject.kind, g.edit])).toEqual([
      ['group', false],
      ['team', true],
    ])
    expect((await devon.getAccess({ idea })).you).toMatchObject({ view: true, edit: false })
  })
})

describe('lists and search', () => {
  test('show what you can see, and catch up with changes from the idea actors', async () => {
    const riley = as('riley')
    const word = `zebra${run}`
    const { idea } = await riley.createIdea({ title: `The ${word} plan`, files: [{ path: 'a.md', content: PLAN }] })
    expect((await riley.searchIdeas({ q: word })).items.map((i) => i.id)).toEqual([idea])
    await expect(riley.searchIdeas({ q: 'ze' })).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('at least 3 characters'),
    })
    expect((await as('maya').searchIdeas({ q: word })).items).toEqual([])

    // an edit makes the idea actor update its row (coalesced, a moment later)
    await riley.edit({ idea, batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'More.' }] } })
    const row = await eventually(
      () => riley.listIdeas({ owner: handle('riley') }).then((page) => page.items.find((i) => i.id === idea)),
      (r) => r?.latest === 2,
    )
    // a row says whose it is and where it's found, by name, not just by ID
    const me = await signIn(app, handle('riley'))
    expect(row).toMatchObject({
      latest: 2,
      place: `@${handle('riley')}`,
      number: expect.any(Number),
      team: null,
      owner: { id: me.id, handle: handle('riley') },
      openComments: 0,
    })
    expect((await riley.listIdeas({ owner: handle('riley') })).items[0]!.id).toBe(idea)

    // its open comments are counted as they come and go
    const { comment } = await riley.addComment({ idea, version: 2, anchor: { kind: 'file', file: 'f1' }, body: 'Why?' })
    expect(
      (
        await eventually(
          () => riley.listIdeas({ owner: handle('riley') }).then((page) => page.items.find((i) => i.id === idea)),
          (r) => r?.openComments === 1,
        )
      )?.openComments,
    ).toBe(1)
    await riley.resolveComment({ idea, comment, resolved: true })
    expect(
      (
        await eventually(
          () => riley.searchIdeas({ q: word }).then((found) => found.items.find((i) => i.id === idea)),
          (r) => r?.openComments === 0,
        )
      )?.openComments,
    ).toBe(0)
  })

  test('show who approved the latest version, who is asked to review, and whether others can see it', async () => {
    const riley = as('riley')
    const maya = as('maya')
    const mayaId = (await maya.me({})).id
    const { idea } = await riley.createIdea({ title: 'Reviewed plan', files: [{ path: 'a.md', content: PLAN }] })
    const listed = () =>
      riley.listIdeas({ owner: handle('riley') }).then((page) => page.items.find((i) => i.id === idea))
    expect(await listed()).toMatchObject({ approvals: [], reviewers: [], visibility: 'private' })

    await riley.setReviewer({ idea, subject: { kind: 'user', id: mayaId }, reviewer: true })
    await maya.reviewIdea({ idea, version: 1, verdict: 'approve' })
    const approved = await eventually(listed, (r) => (r?.approvals.length ?? 0) > 0)
    expect(approved).toMatchObject({
      approvals: [{ id: mayaId, handle: handle('maya') }],
      reviewers: [{ kind: 'user', user: { id: mayaId } }],
      visibility: 'private',
    })

    // a new version: the approval was of the last one, so it no longer counts
    await riley.edit({ idea, batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'More.' }] } })
    expect((await eventually(listed, (r) => r?.latest === 2))?.approvals).toEqual([])

    await riley.setAccess({ idea, subject: { kind: 'everyone' }, access: { edit: false, share: false } })
    expect((await listed())?.visibility).toBe('public')
  })

  test('the version each reviewer asked by name last opened, and no one else’s', async () => {
    const riley = as('riley')
    const maya = as('maya')
    const sam = as('sam')
    const mayaId = (await maya.me({})).id
    const samId = (await sam.me({})).id
    const { idea } = await riley.createIdea({ title: 'Seen plan', files: [{ path: 'a.md', content: PLAN }] })
    await riley.setAccess({ idea, subject: { kind: 'user', id: samId }, access: { edit: false, share: false } })
    await riley.setReviewer({ idea, subject: { kind: 'user', id: mayaId }, reviewer: true })
    await riley.edit({ idea, batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'More.' }] } })

    expect((await riley.listReviews({ idea })).seen).toEqual([])
    expect(await maya.markSeen({ idea, version: 2 })).toEqual({ version: 2 })
    // an older version afterwards: the latest seen stays
    expect(await maya.markSeen({ idea, version: 1 })).toEqual({ version: 2 })
    // someone not asked to review: kept, but not shown
    expect(await sam.markSeen({ idea, version: 2 })).toEqual({ version: 2 })
    expect((await riley.listReviews({ idea })).seen).toEqual([{ user: mayaId, version: 2, at: expect.any(Number) }])
    await expect(maya.markSeen({ idea, version: 3 })).rejects.toMatchObject({ code: 'not_found' })
  })

  test('counts what a list has, open and closed, at its own address', async () => {
    const riley = as('riley')
    const owner = handle('riley')
    const before = await riley.countIdeas({ owner })
    await riley.createIdea({ title: 'Counted', files: [{ path: 'a.md', content: PLAN }] })
    expect(await riley.countIdeas({ owner })).toEqual({ open: before.open + 1, closed: before.closed })
    await expect(riley.countIdeas({ owner: 'no-one-here' })).rejects.toMatchObject({ code: 'not_found' })
  })

  test("a team's idea is listed with its team and description", async () => {
    const riley = as('riley')
    const team = await riley.createTeam({ handle: handle('listed'), name: 'Listed' })
    const { idea } = await riley.createIdea({
      title: 'Listed plan',
      description: 'What it is, in a line.',
      team: team.handle,
      files: [{ path: 'a.md', content: PLAN }],
    })
    const [row] = (await riley.listIdeas({ team: team.handle })).items
    expect(row).toMatchObject({
      id: idea,
      description: 'What it is, in a line.',
      place: team.handle,
      number: 1,
      team: { id: team.id, handle: team.handle, name: 'Listed', archived: false },
    })
  })

  test('people and teams by type-ahead', async () => {
    const riley = as('riley')
    expect((await riley.findUsers({ q: handle('riley').slice(0, 9) })).items.map((u) => u.handle)).toEqual([
      handle('riley'),
    ])
    // a grant names a person by ID; get_person finds them by ID or handle
    // whoami is the person, and what their work is labeled as; get_person is just the person
    const { bot, purpose, ...me } = await riley.me({})
    expect({ bot, purpose }).toEqual({ bot: null, purpose: 'me' })
    expect(await riley.getUser({ user: me.id })).toEqual(me)
    expect(await riley.getUser({ user: `@${me.handle}` })).toEqual(me)
    await expect(riley.getUser({ user: handle('nobody') })).rejects.toMatchObject({ code: 'not_found' })
    await riley.createTeam({ handle: handle('typeahead'), name: 'Type-ahead team' })
    expect((await riley.listTeams({ q: handle('typeahead') })).items.map((t) => t.handle)).toEqual([
      handle('typeahead'),
    ])
  })
})

describe('the move wizard', () => {
  test('previews who loses and gains access, then moves', async () => {
    const riley = as('riley')
    const maya = as('maya')
    const sam = as('sam')
    await Promise.all([maya.me({}), sam.me({})])
    const from = await riley.createTeam({ handle: handle('from'), name: 'From' })
    const to = await riley.createTeam({ handle: handle('to'), name: 'To' })
    await riley.addTeamMember({ team: from.handle, user: handle('maya') })
    await riley.addTeamMember({ team: to.handle, user: handle('sam') })
    const { idea } = await riley.createIdea({
      title: 'Moving',
      team: from.handle,
      files: [{ path: 'a.md', content: PLAN }],
    })

    const preview = await riley.previewMove({ idea, team: to.handle })
    expect(preview.losing).toMatchObject({ count: 1, people: [{ handle: handle('maya') }] })
    expect(preview.gaining).toMatchObject({ count: 1, people: [{ handle: handle('sam') }] })
    expect((await maya.getIdea({ idea })).title).toBe('Moving') // nothing changed yet

    // maya can't move it: she can view but not share
    await expect(maya.moveIdea({ idea, team: to.handle })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await sam.getIdea({ idea }).catch((e) => e.code)).toBe('not_found')
    await expect(sam.findIdea({ place: from.handle, number: 1 })).rejects.toMatchObject({ code: 'not_found' })
    await riley.moveIdea({ idea, team: to.handle })
    await expect(maya.getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
    expect((await sam.getIdea({ idea })).title).toBe('Moving')
    // its new address, and its old one, which now says where it went
    expect(await sam.getIdea({ idea })).toMatchObject({ place: to.handle, number: 1 })
    expect(await sam.findIdea({ place: from.handle, number: 1 })).toEqual({ id: idea, place: to.handle, number: 1 })
    // someone who can't see it learns nothing, whichever address they try
    await expect(maya.findIdea({ place: to.handle, number: 1 })).rejects.toMatchObject({ code: 'not_found' })
    await expect(maya.findIdea({ place: from.handle, number: 1 })).rejects.toMatchObject({ code: 'not_found' })
  })
})
