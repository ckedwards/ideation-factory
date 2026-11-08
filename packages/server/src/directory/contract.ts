// The tests every Directory implementation must pass: the directory actor's
// SQLite now, Postgres if it's added. Each implementation's test file calls
// directoryContract with a way to make an empty directory.
import { describe, expect, test } from 'bun:test'
import type { Directory, IdeaRow, InboxEvent, MovePreview } from './types.ts'

export function directoryContract(name: string, make: () => Promise<Directory>): void {
  async function people() {
    const d = await make()
    for (const handle of ['riley', 'maya', 'sam', 'devon', 'outsider']) {
      await d.ensureUser({ id: `u-${handle}`, handle, name: handle[0]!.toUpperCase() + handle.slice(1) })
    }
    return d
  }
  let clock = 1_000_000
  const idea = (id: string, extra: Partial<IdeaRow> = {}): Omit<IdeaRow, 'number' | 'openComments'> => ({
    id,
    title: `Idea ${id}`,
    description: '',
    team: null,
    owner: 'u-riley',
    status: 'draft',
    latest: 1,
    createdAt: clock,
    updatedAt: clock++,
    ...extra,
  })

  describe(`${name} (Directory contract)`, () => {
    describe('people', () => {
      test('ensureUser is safe to repeat, and type-ahead finds people by handle or name', async () => {
        const d = await people()
        await d.ensureUser({ id: 'u-riley', handle: 'riley', name: 'Someone else' })
        expect(await d.user('u-riley')).toEqual({ id: 'u-riley', handle: 'riley', name: 'Riley', inactive: false })
        expect((await d.findUsers('ma')).map((u) => u.handle)).toEqual(['maya'])
        expect((await d.findUsers('@sa')).map((u) => u.handle)).toEqual(['sam'])
        expect(await d.findUsers('')).toEqual([])
      })

      test('updateUser changes a name or status, and finds no one who isn’t there', async () => {
        const d = await people()
        expect(await d.updateUser('u-maya', { name: 'Maya M', inactive: true })).toEqual({
          id: 'u-maya',
          handle: 'maya',
          name: 'Maya M',
          inactive: true,
        })
        expect((await d.updateUser('u-maya', { inactive: false }))!.inactive).toBe(false)
        expect(await d.updateUser('u-nobody', { name: 'X' })).toBeNull()
      })

      test('updateUser changes a handle (confirmed after single sign-on) and an email (changed at the provider)', async () => {
        const d = await people()
        expect(await d.updateUser('u-maya', { handle: 'Maya-Moss', email: 'Maya.Moss@example.test' })).toMatchObject({
          id: 'u-maya',
          handle: 'maya-moss',
        })
        expect((await d.user('maya-moss'))!.id).toBe('u-maya')
        // the old handle still leads to them
        expect((await d.user('maya'))!.id).toBe('u-maya')
        // unless it was only ever a suggestion they replaced
        await d.updateUser('u-maya', { handle: 'maya-m' }, { keepOldHandle: false })
        expect(await d.user('maya-moss')).toBeNull()
      })
    })

    describe('teams and groups', () => {
      test('the creator is the first admin; handles are validated and unique', async () => {
        const d = await people()
        const team = await d.createTeam('u-riley', { handle: 'Platform', name: 'Platform' })
        expect(team).toMatchObject({
          ok: true,
          value: {
            kind: 'team',
            handle: 'platform',
            members: 1,
            createPolicy: 'members',
            defaults: { members: 'view', public: false, groups: [] },
          },
        })
        expect((await d.members('team', (team as { value: { id: string } }).value.id)).items).toEqual([
          { user: expect.objectContaining({ handle: 'riley' }), role: 'admin' },
        ])
        expect(await d.createTeam('u-maya', { handle: 'platform', name: 'Again' })).toMatchObject({
          ok: false,
          error: { code: 'exists' },
        })
        expect(await d.createTeam('u-maya', { handle: '-bad-', name: 'Bad' })).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
        expect(
          await d.createGroup('u-maya', { handle: 'platform', name: 'A group can share a team’s handle' }),
        ).toMatchObject({ ok: true })
        expect((await d.team('platform'))!.id).toBe((await d.team((team as { value: { id: string } }).value.id))!.id)
      })

      test('creating the same team at once: one wins, the others are told it exists', async () => {
        const d = await people()
        const results = await Promise.all(
          ['u-riley', 'u-maya', 'u-sam'].map((u) => d.createTeam(u, { handle: 'race', name: 'Race' })),
        )
        expect(results.filter((r) => r.ok)).toHaveLength(1)
        expect(results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error.code))).toEqual(['exists', 'exists'])
      })

      test('lists are paged with cursors, and searchable', async () => {
        const d = await people()
        for (let i = 0; i < 30; i++) {
          await d.createTeam('u-riley', { handle: `team-${String(i).padStart(2, '0')}`, name: `Team ${i}` })
        }
        const first = await d.teams({ limit: 25 })
        expect(first.items).toHaveLength(25)
        const second = await d.teams({ limit: 25, cursor: first.next! })
        expect(second.items.map((t) => t.handle)).toEqual(['team-25', 'team-26', 'team-27', 'team-28', 'team-29'])
        expect(second.next).toBeNull()
        expect((await d.teams({ query: 'team-1' })).items).toHaveLength(10)
      })

      test('maintainers add members; only admins give roles or change settings', async () => {
        const d = await people()
        const { id } = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value
        expect(await d.addMember('u-riley', 'team', id, 'u-maya', 'maintainer')).toMatchObject({ ok: true })
        expect(await d.addMember('u-maya', 'team', id, 'u-sam')).toMatchObject({ ok: true, value: { role: 'member' } })
        expect(await d.addMember('u-maya', 'team', id, 'u-devon', 'admin')).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        expect(await d.addMember('u-sam', 'team', id, 'u-devon')).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        expect(await d.updateTeam('u-maya', id, { createPolicy: 'anyone' })).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        expect(
          await d.updateTeam('u-riley', id, {
            createPolicy: 'maintainers',
            defaults: { members: 'edit', public: true, groups: [] },
          }),
        ).toMatchObject({
          ok: true,
          value: { createPolicy: 'maintainers', defaults: { members: 'edit', public: true } },
        })
      })

      test('removing and leaving; a team always keeps an admin', async () => {
        const d = await people()
        const { id } = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value
        await d.addMember('u-riley', 'team', id, 'u-maya', 'maintainer')
        await d.addMember('u-riley', 'team', id, 'u-sam')
        expect(await d.removeMember('u-maya', 'team', id, 'u-riley')).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        expect(await d.removeMember('u-maya', 'team', id, 'u-sam')).toEqual({ ok: true, value: null })
        expect(await d.removeMember('u-riley', 'team', id, 'u-riley')).toMatchObject({
          ok: false,
          error: { code: 'invalid', message: expect.stringContaining('at least one admin') },
        })
        expect(await d.removeMember('u-maya', 'team', id, 'u-maya')).toEqual({ ok: true, value: null })
        expect((await d.team(id))!.members).toBe(1)
      })

      test('joining is by request, approved or denied by a maintainer or admin', async () => {
        const d = await people()
        const { id } = (
          (await d.createGroup('u-riley', { handle: 'security', name: 'Security' })) as { value: { id: string } }
        ).value
        expect(await d.requestToJoin('u-sam', 'group', id)).toEqual({ ok: true, value: { requested: true } })
        expect(await d.requestToJoin('u-sam', 'group', id)).toEqual({ ok: true, value: { requested: true } })
        await d.requestToJoin('u-devon', 'group', id)
        expect(await d.joinRequests('u-sam', 'group', id)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(
          ((await d.joinRequests('u-riley', 'group', id)) as { value: Array<{ handle: string }> }).value
            .map((u) => u.handle)
            .toSorted(),
        ).toEqual(['devon', 'sam'])
        expect(await d.decide('u-riley', 'group', id, 'u-sam', true)).toEqual({ ok: true, value: null })
        expect(await d.decide('u-riley', 'group', id, 'u-devon', false)).toEqual({ ok: true, value: null })
        expect((await d.members('group', id)).items.map((m) => m.user.handle)).toEqual(['riley', 'sam'])
        expect(((await d.joinRequests('u-riley', 'group', id)) as { value: unknown[] }).value).toEqual([])
      })
    })

    describe('access', () => {
      async function withTeam() {
        const d = await people()
        const team = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        await d.addMember('u-riley', 'team', team, 'u-maya')
        return { d, team }
      }

      test('who can create ideas in a team follows its policy', async () => {
        const { d, team } = await withTeam()
        expect(await d.canCreateIdea('u-outsider', null)).toEqual({ ok: true, value: null })
        expect(await d.canCreateIdea('u-maya', team)).toEqual({ ok: true, value: null })
        expect(await d.canCreateIdea('u-outsider', team)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        await d.updateTeam('u-riley', team, { createPolicy: 'maintainers' })
        expect(await d.canCreateIdea('u-maya', team)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        await d.updateTeam('u-riley', team, { createPolicy: 'anyone' })
        expect(await d.canCreateIdea('u-outsider', team)).toEqual({ ok: true, value: null })
      })

      test('an idea outside a team is private to its owner', async () => {
        const d = await people()
        await d.registerIdea(idea('i1'))
        expect(await d.permission('i1', 'u-riley')).toEqual({ view: true, edit: true, share: true, owner: true })
        expect(await d.permission('i1', 'u-maya')).toEqual({ view: false, edit: false, share: false, owner: false })
        expect(await d.grants('i1')).toEqual([])
      })

      test("an idea in a team starts with the team's defaults, and access follows membership", async () => {
        const { d, team } = await withTeam()
        await d.registerIdea(idea('i1', { team, owner: 'u-maya' }))
        expect(await d.grants('i1')).toEqual([
          { subject: { kind: 'team', id: team }, edit: false, share: false, reviewer: false },
        ])
        expect(await d.permission('i1', 'u-riley')).toMatchObject({ view: true, edit: false, share: true }) // a team admin can share
        await d.addMember('u-riley', 'team', team, 'u-sam')
        expect((await d.permission('i1', 'u-sam')).view).toBe(true)
        await d.removeMember('u-riley', 'team', team, 'u-sam')
        expect((await d.permission('i1', 'u-sam')).view).toBe(false)
        expect((await d.permission('i1', 'u-outsider')).view).toBe(false)
      })

      test('registering an idea again (a retry) changes nothing', async () => {
        const { d, team } = await withTeam()
        await d.registerIdea(idea('i1', { team }))
        await d.setGrant('u-riley', 'i1', { kind: 'team', id: team }, null)
        await d.registerIdea(idea('i1', { team }))
        expect(await d.grants('i1')).toEqual([])
      })

      test('sharing: people, groups and everyone; only with share access', async () => {
        const { d } = await withTeam()
        const group = (
          (await d.createGroup('u-devon', { handle: 'security', name: 'Security' })) as { value: { id: string } }
        ).value.id
        await d.registerIdea(idea('i1'))
        expect(
          await d.setGrant('u-maya', 'i1', { kind: 'user', id: 'u-maya' }, { edit: true, share: true }),
        ).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(
          await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, { edit: true, share: false }),
        ).toMatchObject({ ok: true })
        expect(await d.permission('i1', 'u-maya')).toEqual({ view: true, edit: true, share: false, owner: false })
        expect(
          await d.setGrant('u-riley', 'i1', { kind: 'group', id: group }, { edit: false, share: false }),
        ).toMatchObject({ ok: true })
        expect((await d.permission('i1', 'u-devon')).view).toBe(true)
        expect(await d.setGrant('u-riley', 'i1', { kind: 'everyone' }, { edit: true, share: false })).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
        expect(await d.setGrant('u-riley', 'i1', { kind: 'everyone' }, { edit: false, share: false })).toMatchObject({
          ok: true,
        })
        expect(await d.permission('i1', 'u-outsider')).toEqual({ view: true, edit: false, share: false, owner: false })
        expect(
          await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-riley' }, { edit: false, share: false }),
        ).toMatchObject({ ok: false, error: { code: 'invalid' } })
        // removing a grant
        await d.setGrant('u-riley', 'i1', { kind: 'everyone' }, null)
        expect((await d.permission('i1', 'u-outsider')).view).toBe(false)
      })

      test("a team's approval requirements: set by maintainers, checked against an idea's approvers", async () => {
        const { d, team } = await withTeam()
        const group = async (handle: string, members: string[]) => {
          const id = ((await d.createGroup('u-devon', { handle, name: handle })) as { value: { id: string } }).value.id
          for (const m of members) {
            await d.addMember('u-devon', 'group', id, m)
          }
          return id
        }
        const security = await group('security', ['u-sam'])
        const legal = await group('legal', ['u-sam', 'u-maya'])
        const design = await group('design', ['u-outsider'])
        const wanted = {
          approvals: 2,
          groups: [
            { mode: 'each' as const, groups: ['security', 'legal'], request: true },
            { mode: 'any' as const, groups: ['design', 'legal'], request: false },
          ],
          resolved: true,
        }
        // a member can't; a maintainer can
        expect(await d.setRequirements('u-maya', team, wanted)).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        await d.addMember('u-riley', 'team', team, 'u-sam', 'maintainer')
        const set = await d.setRequirements('u-sam', team, wanted)
        expect(set).toMatchObject({
          ok: true,
          value: {
            requirements: {
              approvals: 2,
              groups: [
                { mode: 'each', groups: [security, legal], request: true },
                { mode: 'any', groups: [design, legal], request: false },
              ],
              resolved: true,
            },
          },
        })
        expect(
          await d.setRequirements('u-sam', team, {
            ...wanted,
            groups: [{ mode: 'any', groups: ['nope'], request: false }],
          }),
        ).toMatchObject({ ok: false, error: { code: 'invalid' } })

        await d.registerIdea(idea('i1', { team }))
        // nobody yet
        let check = await d.checkRequirements('i1', [], 1)
        expect(check.met).toBe(false)
        expect(check.checks.map((c) => [c.kind, c.met])).toEqual([
          ['approvals', false],
          ['groups', false],
          ['groups', false],
          ['resolved', false],
        ])
        // sam is in security and legal: one approval meets both groups of the "each of" rule
        check = await d.checkRequirements('i1', ['u-sam'], 0)
        expect(check.checks.map((c) => c.met)).toEqual([false, true, true, true])
        expect(check.checks[1]).toMatchObject({
          groups: [
            { id: security, handle: 'security', approvedBy: ['u-sam'] },
            { id: legal, handle: 'legal', approvedBy: ['u-sam'] },
          ],
        })
        check = await d.checkRequirements('i1', ['u-sam', 'u-riley'], 0)
        expect(check).toMatchObject({ met: true })

        // an idea outside a team needs nothing
        await d.registerIdea(idea('i2'))
        expect(await d.checkRequirements('i2', [], 3)).toEqual({ met: true, checks: [] })

        // going out for review asks the groups whose rule says so, once
        expect(await d.requestRuleGroups('i1')).toEqual([security, legal])
        expect(await d.requestRuleGroups('i1')).toEqual([])
        // grants are listed by ID, which is random: compare them in any order
        const asked = (await d.grants('i1')).filter((g) => g.reviewer).map((g) => g.subject)
        expect(asked).toHaveLength(2)
        expect(asked).toEqual(
          expect.arrayContaining([
            { kind: 'group', id: legal },
            { kind: 'group', id: security },
          ]),
        )
        expect((await d.permission('i1', 'u-sam')).view).toBe(true)
      })

      test('asking for a review gives view access; taking someone off leaves it, and removing access ends both', async () => {
        const { d, team } = await withTeam()
        const group = (
          (await d.createGroup('u-devon', { handle: 'security', name: 'Security' })) as { value: { id: string } }
        ).value.id
        await d.registerIdea(idea('i1', { team }))
        expect(await d.setReviewer('u-sam', 'i1', { kind: 'user', id: 'u-sam' }, true)).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        expect(await d.setReviewer('u-riley', 'i1', { kind: 'user', id: 'u-riley' }, true)).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
        expect(await d.setReviewer('u-riley', 'i1', { kind: 'team', id: team }, true)).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
        expect((await d.permission('i1', 'u-sam')).view).toBe(false)
        await d.setReviewer('u-riley', 'i1', { kind: 'user', id: '@sam' }, true)
        await d.setReviewer('u-riley', 'i1', { kind: 'group', id: 'security' }, true)
        // someone who already has access keeps it, and is asked too
        await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, { edit: true, share: false })
        await d.setReviewer('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, true)
        expect((await d.permission('i1', 'u-sam')).view).toBe(true)
        expect((await d.permission('i1', 'u-devon')).view).toBe(true)
        expect(await d.grants('i1')).toEqual([
          { subject: { kind: 'group', id: group }, edit: false, share: false, reviewer: true },
          { subject: { kind: 'team', id: team }, edit: false, share: false, reviewer: false },
          { subject: { kind: 'user', id: 'u-maya' }, edit: true, share: false, reviewer: true },
          { subject: { kind: 'user', id: 'u-sam' }, edit: false, share: false, reviewer: true },
        ])
        // off the reviewers, still a viewer
        await d.setReviewer('u-riley', 'i1', { kind: 'user', id: 'u-sam' }, false)
        expect((await d.permission('i1', 'u-sam')).view).toBe(true)
        // changing someone's access keeps them a reviewer; removing it ends both
        await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, { edit: false, share: false })
        await d.setGrant('u-riley', 'i1', { kind: 'group', id: group }, null)
        expect((await d.grants('i1')).filter((g) => g.reviewer).map((g) => g.subject)).toEqual([
          { kind: 'user', id: 'u-maya' },
        ])
      })

      test('people, groups and teams can be named by handle, and are stored by ID', async () => {
        const { d, team } = await withTeam()
        const group = (
          (await d.createGroup('u-devon', { handle: 'security', name: 'Security' })) as { value: { id: string } }
        ).value.id
        await d.registerIdea(idea('i1'))
        const view = { edit: false, share: false }
        expect(await d.setGrant('u-riley', 'i1', { kind: 'user', id: '@sam' }, view)).toMatchObject({ ok: true })
        expect(await d.setGrant('u-riley', 'i1', { kind: 'group', id: 'security' }, view)).toMatchObject({ ok: true })
        expect(await d.setGrant('u-riley', 'i1', { kind: 'team', id: '@core' }, view)).toMatchObject({ ok: true })
        expect(await d.grants('i1')).toEqual([
          { subject: { kind: 'group', id: group }, ...view, reviewer: false },
          { subject: { kind: 'team', id: team }, ...view, reviewer: false },
          { subject: { kind: 'user', id: 'u-sam' }, ...view, reviewer: false },
        ])
        expect((await d.permission('i1', 'u-devon')).view).toBe(true)
        // and removed by handle
        await d.setGrant('u-riley', 'i1', { kind: 'group', id: 'security' }, null)
        expect((await d.permission('i1', 'u-devon')).view).toBe(false)
        expect(await d.setGrant('u-riley', 'i1', { kind: 'group', id: 'nobody' }, view)).toMatchObject({
          ok: false,
          error: { code: 'not_found' },
        })

        // a team's default groups, too
        const updated = await d.updateTeam('u-riley', team, {
          defaults: { members: 'view', public: false, groups: [{ group: 'security', edit: true }] },
        })
        expect((updated as { value: { defaults: { groups: unknown } } }).value.defaults.groups).toEqual([
          { group, edit: true },
        ])
        await d.registerIdea(idea('i2', { team }))
        expect((await d.permission('i2', 'u-devon')).edit).toBe(true)
      })
    })

    describe('token grants', () => {
      /** Riley owns i1 (in core), i2 (in web) and i3 (outside teams); maya can view i1. */
      async function ideas() {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        const web = ((await d.createTeam('u-riley', { handle: 'web', name: 'Web' })) as { value: { id: string } }).value
          .id
        await d.registerIdea(idea('i1', { team: core }))
        await d.registerIdea(idea('i2', { team: web }))
        await d.registerIdea(idea('i3'))
        await d.addMember('u-riley', 'team', core, 'u-maya')
        return { d, core, web }
      }
      const value = <T>(r: { ok: boolean; value?: T }) => (r as { value: T }).value
      const full = { view: true, edit: true, share: true, owner: true }

      test('are made with a purpose and optional limits, checked as they are made', async () => {
        const { d, core } = await ideas()
        expect(await d.createTokenGrant('u-riley', { purpose: 'bot-for-me' })).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
        expect(await d.createTokenGrant('u-riley', { purpose: 'me', limits: { teams: ['nowhere'] } })).toMatchObject({
          ok: false,
          error: { code: 'not_found' },
        })
        expect(await d.createTokenGrant('u-maya', { purpose: 'me', limits: { ideas: ['i2'] } })).toMatchObject({
          ok: false,
          error: { code: 'not_found' }, // maya can't see i2
        })
        expect(await d.createTokenGrant('u-riley', { purpose: 'me', limits: {} })).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
        const made = value<{ id: string }>(
          await d.createTokenGrant('u-riley', {
            purpose: 'bot-for-me',
            bot: 'planbot',
            readOnly: true,
            limits: { teams: ['core'], ideas: ['i3'] },
          }),
        )
        expect(await d.tokenGrant(made.id)).toEqual({
          id: made.id,
          user: 'u-riley',
          purpose: 'bot-for-me',
          bot: 'planbot',
          readOnly: true,
          limits: { teams: [core], ideas: ['i3'], noTeam: false },
          createdAt: expect.any(Number),
        })
      })

      test('only ever narrow what their owner can do', async () => {
        const { d } = await ideas()
        const readOnly = value<{ id: string }>(await d.createTokenGrant('u-riley', { purpose: 'me', readOnly: true }))
        expect(await d.permission('i2', 'u-riley', readOnly.id)).toEqual({ ...full, edit: false, share: false })

        const core = value<{ id: string }>(
          await d.createTokenGrant('u-riley', { purpose: 'me', limits: { teams: ['core'] } }),
        )
        expect(await d.permission('i1', 'u-riley', core.id)).toEqual({ ...full, share: false })
        expect((await d.permission('i2', 'u-riley', core.id)).view).toBe(false)
        expect((await d.permission('i3', 'u-riley', core.id)).view).toBe(false)

        const outside = value<{ id: string }>(
          await d.createTokenGrant('u-riley', { purpose: 'me', limits: { noTeam: true, ideas: ['i2'] } }),
        )
        expect((await d.permission('i3', 'u-riley', outside.id)).view).toBe(true)
        expect((await d.permission('i2', 'u-riley', outside.id)).view).toBe(true)
        expect((await d.permission('i1', 'u-riley', outside.id)).view).toBe(false)

        // never more than the person has: maya's unlimited token still can't see i2
        const maya = value<{ id: string }>(await d.createTokenGrant('u-maya', { purpose: 'me' }))
        expect((await d.permission('i1', 'u-maya', maya.id)).view).toBe(true)
        expect((await d.permission('i2', 'u-maya', maya.id)).view).toBe(false)
        // and only its owner's: riley can't use maya's grant
        expect((await d.permission('i1', 'u-riley', maya.id)).view).toBe(false)

        // revoked: nothing, at once
        expect(await d.revokeTokenGrant('u-maya', core.id)).toMatchObject({ ok: false, error: { code: 'not_found' } })
        expect(await d.revokeTokenGrant('u-riley', core.id)).toEqual({ ok: true, value: null })
        expect((await d.permission('i1', 'u-riley', core.id)).view).toBe(false)
        expect(await d.tokenGrant(core.id)).toBeNull()
      })

      test('narrow lists, search and where ideas can be made', async () => {
        const { d, core, web } = await ideas()
        const grant = value<{ id: string }>(
          await d.createTokenGrant('u-riley', { purpose: 'me', limits: { teams: ['core'] } }),
        )
        expect((await d.listIdeas('u-riley')).items.map((i) => i.id).sort()).toEqual(['i1', 'i2', 'i3'])
        expect((await d.listIdeas('u-riley', {}, grant.id)).items.map((i) => i.id)).toEqual(['i1'])
        expect((await d.searchIdeas('u-riley', 'idea', 25, grant.id)).items.map((i) => i.id)).toEqual(['i1'])

        expect(await d.canCreateIdea('u-riley', core, grant.id)).toEqual({ ok: true, value: null })
        expect(await d.canCreateIdea('u-riley', web, grant.id)).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        expect(await d.canCreateIdea('u-riley', null, grant.id)).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        const readOnly = value<{ id: string }>(await d.createTokenGrant('u-riley', { purpose: 'me', readOnly: true }))
        expect(await d.canCreateIdea('u-riley', null, readOnly.id)).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
      })
    })

    describe('memberships and roles', () => {
      test("someone's teams and groups, with their role, and those they've asked to join", async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        const web = ((await d.createTeam('u-devon', { handle: 'web', name: 'Web' })) as { value: { id: string } }).value
          .id
        const sec = ((await d.createGroup('u-riley', { handle: 'sec', name: 'Security' })) as { value: { id: string } })
          .value.id
        await d.addMember('u-riley', 'team', core, 'u-maya', 'maintainer')
        await d.addMember('u-riley', 'group', sec, 'u-maya')
        await d.requestToJoin('u-maya', 'team', web)
        expect(await d.memberships('u-maya')).toEqual({
          teams: [
            { id: core, handle: 'core', name: 'Core', archived: false, role: 'maintainer', watch: 'participating' },
          ],
          groups: [{ id: sec, handle: 'sec', name: 'Security', role: 'member' }],
          requested: [{ kind: 'team', id: web }],
        })
        expect(await d.memberships('u-outsider')).toEqual({ teams: [], groups: [], requested: [] })
      })

      test('only an admin changes a role, and never so the team has no admin', async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        await d.addMember('u-riley', 'team', core, 'u-maya', 'maintainer')
        // a maintainer can't demote the admin, or promote anyone
        expect(await d.addMember('u-maya', 'team', core, 'u-riley', 'member')).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        })
        // the last admin can't be made something less
        expect(await d.addMember('u-riley', 'team', core, 'u-riley', 'member')).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
        // with a second admin, they can
        expect((await d.addMember('u-riley', 'team', core, 'u-maya', 'admin')).ok).toBe(true)
        expect((await d.addMember('u-riley', 'team', core, 'u-riley', 'member')).ok).toBe(true)
        expect((await d.memberships('u-riley')).teams[0]!.role).toBe('member')
      })
    })

    describe('reads in one call', () => {
      test('people by ID, in one read; anyone not found is left out', async () => {
        const d = await people()
        const found = await d.users(['u-maya', 'u-riley', 'u-nobody', 'u-maya'])
        expect(found.map((u) => u.handle).sort()).toEqual(['maya', 'riley'])
        expect(await d.users([])).toEqual([])
      })

      test('an idea as one reader may see it, and finding it only for those who can', async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        await d.registerIdea(idea('i1', { team: core }))
        expect(await d.ideaFor('i1', 'u-riley')).toEqual({
          permission: { view: true, edit: true, share: true, owner: true },
          team: core,
          place: { id: 'i1', place: 'core', number: 1 },
        })
        expect((await d.ideaFor('i1', 'u-outsider'))!.permission.view).toBe(false)
        expect(await d.ideaFor('nothing', 'u-riley')).toBeNull()
        expect(await d.findIdeaFor('core', 1, 'u-riley')).toEqual({ id: 'i1', place: 'core', number: 1 })
        expect(await d.findIdeaFor('core', 1, 'u-outsider')).toBeNull()
      })
    })

    describe("an idea's number and address", () => {
      test("each team numbers its ideas from 1, and so does each person's own; the address finds the idea", async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        await d.registerIdea(idea('i1', { team: core }))
        await d.registerIdea(idea('i2'))
        await d.registerIdea(idea('i3', { team: core }))
        await d.registerIdea(idea('i4', { owner: 'u-maya' }))
        expect((await d.idea('i3'))!.number).toBe(2)
        expect(await d.placeOf('i1')).toEqual({ id: 'i1', place: 'core', number: 1 })
        expect(await d.placeOf('i2')).toEqual({ id: 'i2', place: '@riley', number: 1 })
        expect(await d.placeOf('i4')).toEqual({ id: 'i4', place: '@maya', number: 1 })
        expect(await d.findIdea('core', 2)).toEqual({ id: 'i3', place: 'core', number: 2 })
        expect(await d.findIdea('@riley', 1)).toEqual({ id: 'i2', place: '@riley', number: 1 })
        expect(await d.findIdea('core', 9)).toBeNull()
        expect(await d.findIdea('nowhere', 1)).toBeNull()
        // registering again (a retry) doesn't use up a number
        await d.registerIdea(idea('i1', { team: core }))
        await d.registerIdea(idea('i5', { team: core }))
        expect((await d.idea('i5'))!.number).toBe(3)
      })

      test('a moved idea gets the next number in its new place, and its old address still finds it', async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        const web = ((await d.createTeam('u-riley', { handle: 'web', name: 'Web' })) as { value: { id: string } }).value
          .id
        await d.registerIdea(idea('w1', { team: web }))
        await d.registerIdea(idea('i1', { team: core }))
        expect((await d.moveIdea('u-riley', 'i1', web)).ok).toBe(true)
        expect(await d.placeOf('i1')).toEqual({ id: 'i1', place: 'web', number: 2 })
        expect(await d.findIdea('core', 1)).toEqual({ id: 'i1', place: 'web', number: 2 })
        // out of any team: among its owner's own
        expect((await d.moveIdea('u-riley', 'i1', null)).ok).toBe(true)
        expect(await d.findIdea('web', 2)).toEqual({ id: 'i1', place: '@riley', number: 1 })
        expect(await d.findIdea('core', 1)).toEqual({ id: 'i1', place: '@riley', number: 1 })
        // a number, once given, is never given again
        await d.registerIdea(idea('i2', { team: core }))
        expect((await d.idea('i2'))!.number).toBe(2)
      })

      test("a team can't take a handle the site's own pages use", async () => {
        const d = await people()
        expect(await d.createTeam('u-riley', { handle: 'api', name: 'API' })).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
      })
    })

    describe('handles that change', () => {
      test("a renamed team keeps its old handle leading to it, ideas' addresses too, until another team takes it", async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        await d.registerIdea(idea('i1', { team: core }))
        expect(await d.updateTeam('u-maya', core, { handle: 'platform' })).toMatchObject({ ok: false })
        expect(await d.updateTeam('u-riley', core, { handle: 'api' })).toMatchObject({
          ok: false,
          error: { code: 'invalid' },
        })
        expect(
          await d.updateTeam('u-riley', core, {
            handle: 'platform',
            name: 'Platform',
            description: 'Shared services.',
          }),
        ).toMatchObject({ ok: true, value: { handle: 'platform', name: 'Platform', description: 'Shared services.' } })
        expect((await d.team('core'))!.id).toBe(core)
        // an idea's old address finds it, and says where it is now
        expect(await d.findIdea('core', 1)).toEqual({ id: 'i1', place: 'platform', number: 1 })
        // the old handle is kept for it a while: another team can't take it, it can take it back
        expect(await d.parkedUntil('team', 'core', null)).toEqual(expect.any(Number))
        expect(await d.createTeam('u-devon', { handle: 'core', name: 'New core' })).toMatchObject({
          ok: false,
          error: { code: 'exists', message: expect.stringContaining('kept for them') },
        })
        expect(await d.updateTeam('u-riley', core, { handle: 'core' })).toMatchObject({
          ok: true,
          value: { handle: 'core' },
        })
        await d.updateTeam('u-riley', core, { handle: 'platform' })
        // released by a site admin, another team takes it: it's theirs now
        await d.releaseHandle('team', 'core', 'unused')
        const other = (
          (await d.createTeam('u-devon', { handle: 'core', name: 'New core' })) as { value: { id: string } }
        ).value.id
        expect((await d.team('core'))!.id).toBe(other)
        expect(await d.findIdea('core', 1)).toBeNull()
        // and a taken handle can't be renamed to
        expect(await d.updateTeam('u-riley', core, { handle: 'core' })).toMatchObject({
          ok: false,
          error: { code: 'exists' },
        })
      })

      test("a person's old handle leads to them, until someone else takes it", async () => {
        const d = await people()
        await d.updateUser('u-maya', { handle: 'maya-moss' })
        expect((await d.user('maya'))!.id).toBe('u-maya')
        await d.ensureUser({ id: 'u-new', handle: 'maya', name: 'Another Maya' })
        expect((await d.user('maya'))!.id).toBe('u-new')
        expect((await d.user('maya-moss'))!.id).toBe('u-maya')
      })

      test('releasing a team handle renames its holder and leaves it leading nowhere', async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        await d.updateTeam('u-riley', core, { handle: 'squat' })
        expect(await d.releaseHandle('team', 'squat', 'released-1')).toEqual({ owner: core })
        expect((await d.team(core))!.handle).toBe('released-1')
        expect(await d.team('squat')).toBeNull()
        // its older alias still leads to it, until released too
        expect((await d.team('core'))!.id).toBe(core)
        expect(await d.releaseHandle('team', 'core', 'unused')).toEqual({ owner: core })
        expect(await d.team('core')).toBeNull()
        expect(await d.releaseHandle('team', 'nothing', 'unused')).toEqual({ owner: null })
      })
    })

    describe('moving an idea (the move wizard)', () => {
      test('the preview says who loses and gains access; nothing changes until the move', async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        const web = ((await d.createTeam('u-devon', { handle: 'web', name: 'Web' })) as { value: { id: string } }).value
          .id
        await d.addMember('u-riley', 'team', core, 'u-maya')
        await d.addMember('u-devon', 'team', web, 'u-riley')
        await d.addMember('u-devon', 'team', web, 'u-sam')
        await d.registerIdea(idea('i1', { team: core }))

        const preview = await d.previewMove('u-riley', 'i1', web)
        expect(preview).toMatchObject({
          ok: true,
          value: {
            from: core,
            to: web,
            grants: { now: [{ subject: { kind: 'team', id: core } }], after: [{ subject: { kind: 'team', id: web } }] },
            losing: { count: 1, people: [expect.objectContaining({ handle: 'maya' })], everyone: false },
            gaining: { count: 2, everyone: false },
          },
        })
        expect((await d.idea('i1'))!.team).toBe(core)
        expect((await d.permission('i1', 'u-maya')).view).toBe(true)

        // keep the old team's access, as the wizard allows
        const kept = await d.previewMove('u-riley', 'i1', web, { keep: [{ kind: 'team', id: core }] })
        expect((kept as { value: MovePreview }).value.losing.count).toBe(0)
        // the adjustments can name teams by handle
        const byHandle = await d.previewMove('u-riley', 'i1', web, {
          keep: [{ kind: 'team', id: 'core' }],
          skip: [{ kind: 'team', id: '@web' }],
        })
        expect((byHandle as { value: MovePreview }).value.grants.after).toEqual([
          { subject: { kind: 'team', id: core }, edit: false, share: false, reviewer: false },
        ])
        expect(await d.previewMove('u-riley', 'i1', web, { keep: [{ kind: 'team', id: 'nowhere' }] })).toMatchObject({
          ok: false,
          error: { code: 'not_found' },
        })

        const moved = await d.moveIdea('u-riley', 'i1', web)
        expect(moved.ok).toBe(true)
        expect((await d.idea('i1'))!.team).toBe(web)
        expect((await d.permission('i1', 'u-maya')).view).toBe(false)
        expect((await d.permission('i1', 'u-sam')).view).toBe(true)
      })

      test('moving needs share access, and permission to create ideas in the new team', async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        const closed = (
          (await d.createTeam('u-devon', { handle: 'closed', name: 'Closed' })) as { value: { id: string } }
        ).value.id
        await d.addMember('u-riley', 'team', core, 'u-maya')
        await d.registerIdea(idea('i1', { team: core, owner: 'u-riley' }))
        expect(await d.moveIdea('u-maya', 'i1', null)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.moveIdea('u-riley', 'i1', closed)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.moveIdea('u-outsider', 'i1', null)).toMatchObject({ ok: false, error: { code: 'not_found' } })
        // out of a team: private to its owner again
        expect(await d.moveIdea('u-riley', 'i1', null)).toMatchObject({
          ok: true,
          value: { to: null, losing: { count: 1 } },
        })
        expect(await d.grants('i1')).toEqual([])
      })
    })

    describe('the idea index', () => {
      test('lists only what you can see, newest first, paged with cursors', async () => {
        const { d, team } = await (async () => {
          const dir = await people()
          const t = ((await dir.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
            .value.id
          await dir.addMember('u-riley', 'team', t, 'u-maya')
          return { d: dir, team: t }
        })()
        for (let i = 0; i < 30; i++) {
          await d.registerIdea(idea(`team-${i}`, { team }))
        }
        await d.registerIdea(idea('private', { owner: 'u-riley' }))
        await d.registerIdea(idea('mayas', { owner: 'u-maya' }))

        const first = await d.listIdeas('u-maya', { limit: 25 })
        expect(first.items[0]!.id).toBe('mayas')
        expect(first.items.some((i) => i.id === 'private')).toBe(false)
        const second = await d.listIdeas('u-maya', { limit: 25, cursor: first.next! })
        expect([...first.items, ...second.items]).toHaveLength(31)
        expect(second.next).toBeNull()
        expect((await d.listIdeas('u-outsider')).items).toEqual([])
        expect((await d.listIdeas('u-riley', { owner: 'u-maya' })).items).toEqual([]) // riley can't see maya's private idea
        expect((await d.listIdeas('u-maya', { team, limit: 100 })).items).toHaveLength(30)
      })

      test("search finds the ideas you can see even when many you can't see match better", async () => {
        const d = await people()
        for (let i = 0; i < 600; i++) {
          await d.registerIdea(idea(`hidden-${i}`, { title: 'Sync', owner: 'u-maya' }))
        }
        await d.registerIdea(idea('mine', { title: 'An older plan to sync the field app', owner: 'u-riley' }))
        expect((await d.searchIdeas('u-riley', 'sync')).items.map((i) => i.id)).toEqual(['mine'])
      })

      test('updates keep the row current, and an older update never overwrites a newer one', async () => {
        const d = await people()
        await d.registerIdea(idea('i1', { updatedAt: 100 }))
        await d.updateIdea({
          id: 'i1',
          title: 'Newer',
          status: 'requesting-review',
          latest: 3,
          updatedAt: 300,
          description: 'Now with a plan.',
          openComments: 2,
        })
        await d.updateIdea({
          id: 'i1',
          title: 'Older',
          status: 'draft',
          latest: 2,
          updatedAt: 200,
          description: '',
          openComments: 5,
        })
        expect(await d.idea('i1')).toMatchObject({
          title: 'Newer',
          status: 'requesting-review',
          latest: 3,
          updatedAt: 300,
          description: 'Now with a plan.',
          openComments: 2,
        })
      })

      test('search finds text anywhere in a title, ranks closer matches first, and respects access', async () => {
        const d = await people()
        await d.registerIdea(idea('a', { title: 'Offline-first sync for the field app' }))
        await d.registerIdea(idea('b', { title: 'Sync' }))
        await d.registerIdea(idea('c', { title: 'Billing: online invoices' }))
        await d.registerIdea(idea('hidden', { title: 'Sync secrets', owner: 'u-maya' }))
        expect((await d.searchIdeas('u-riley', 'sync')).items.map((i) => i.id)).toEqual(['b', 'a'])
        expect((await d.searchIdeas('u-riley', 'line')).items.map((i) => i.id).toSorted()).toEqual(['a', 'c'])
        expect((await d.searchIdeas('u-maya', 'sync')).items.map((i) => i.id)).toEqual(['hidden'])
        // a search needs three characters; shorter terms are ignored
        expect(await d.searchIdeas('u-riley', 'of')).toEqual({ items: [], incomplete: false })
        expect((await d.searchIdeas('u-riley', 'of sync')).items.map((i) => i.id)).toEqual(['b', 'a'])
        // renaming updates search
        await d.updateIdea({
          id: 'b',
          title: 'Replication',
          description: '',
          status: 'draft',
          latest: 2,
          openComments: 0,
          updatedAt: clock++,
        })
        expect((await d.searchIdeas('u-riley', 'sync')).items.map((i) => i.id)).toEqual(['a'])
      })
    })

    describe('the inbox', () => {
      const me = (user: string) => ({ user, bot: null, purpose: 'me' as const })
      // the directory times review requests by the real clock, so these follow it
      let tick = 0
      const event = (kind: InboxEvent['kind'], actor: InboxEvent['actor'], detail = {}): InboxEvent => ({
        kind,
        actor,
        at: Date.now() + ++tick,
        detail,
      })
      const ids = async (d: Directory, user: string, filter = {}) =>
        (await d.inbox(user, filter)).items.map((r) => [r.idea.id, r.reason, r.newCount])

      test('the owner, people asked to review (every member of a group), and those who take part hear about it', async () => {
        const d = await people()
        await d.registerIdea(idea('i1'))
        const group = (
          (await d.createGroup('u-devon', { handle: 'security', name: 'Security' })) as {
            value: { id: string }
          }
        ).value.id
        await d.addMember('u-devon', 'group', group, 'u-sam')
        // asked by name, and through a group: each hears of the request
        await d.setReviewer('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, true)
        await d.setReviewer('u-riley', 'i1', { kind: 'group', id: group }, true)
        expect(await ids(d, 'u-maya')).toEqual([['i1', 'review-requested', 1]])
        expect(await ids(d, 'u-sam')).toEqual([['i1', 'group-review', 1]])
        expect(await ids(d, 'u-devon')).toEqual([['i1', 'group-review', 1]])
        // the one asking doesn't hear of it
        expect(await ids(d, 'u-riley')).toEqual([])

        // maya comments: everyone else hears; she doesn't, of her own comment
        await d.notify({ idea: 'i1', events: [event('comment', me('u-maya'), { comment: 'c1', body: 'Why?' })] })
        expect(await ids(d, 'u-riley')).toEqual([['i1', 'author', 1]])
        expect(await ids(d, 'u-maya')).toEqual([['i1', 'review-requested', 1]])
        expect(await ids(d, 'u-sam')).toEqual([['i1', 'group-review', 2]])
        // several events, one row: bundled per idea
        await d.notify({
          idea: 'i1',
          events: [event('version', me('u-riley'), { version: 2 }), event('status', me('u-riley'))],
        })
        const [row] = (await d.inbox('u-sam')).items
        expect(row).toMatchObject({
          idea: { id: 'i1', title: 'Idea i1' },
          newCount: 4,
          done: false,
          latest: { kind: 'status', actor: me('u-riley') },
        })
        expect(await d.unreadCount('u-sam')).toBe(1)
        // the owner doesn't hear of their own version
        expect(await ids(d, 'u-riley')).toEqual([['i1', 'author', 1]])

        // outside the group and not asked: taking part subscribes you
        await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-outsider' }, { edit: false, share: false })
        await d.notify({ idea: 'i1', events: [event('reply', me('u-outsider'))] })
        await d.notify({ idea: 'i1', events: [event('comment', me('u-riley'))] })
        expect(await ids(d, 'u-outsider')).toEqual([['i1', 'participating', 1]])
        expect(await d.subscription('u-outsider', 'i1')).toEqual({ subscribed: true, reason: 'participating' })
      })

      test('read, done and back; unsubscribing silences all but review requests', async () => {
        const d = await people()
        await d.registerIdea(idea('i1'))
        await d.registerIdea(idea('i2'))
        await d.setReviewer('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, true)
        await d.setReviewer('u-riley', 'i2', { kind: 'user', id: 'u-maya' }, true)
        expect(await d.unreadCount('u-maya')).toBe(2)
        expect(await d.markInbox('u-maya', ['i1'], { read: true })).toBe(1)
        expect(await ids(d, 'u-maya', { unread: true })).toEqual([['i2', 'review-requested', 1]])
        await d.markInbox('u-maya', ['i2'], { done: true })
        expect(await ids(d, 'u-maya')).toEqual([['i1', 'review-requested', 0]])
        expect(await ids(d, 'u-maya', { done: true })).toEqual([['i2', 'review-requested', 1]])
        // something new brings a done idea back
        await d.notify({ idea: 'i2', events: [event('version', me('u-riley'))] })
        expect((await ids(d, 'u-maya')).map((r) => r[0])).toEqual(['i2', 'i1'])

        // unsubscribed: nothing more, not even as a reviewer…
        expect(await d.setSubscription('u-maya', 'i1', false)).toEqual({
          ok: true,
          value: { subscribed: false, reason: null },
        })
        await d.markInbox('u-maya', null, { read: true })
        await d.notify({ idea: 'i1', events: [event('comment', me('u-riley'))] })
        expect(await d.unreadCount('u-maya')).toBe(0)
        // …except being asked to review again
        await d.setReviewer('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, false)
        await d.setReviewer('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, true)
        expect(await d.unreadCount('u-maya')).toBe(1)
        // subscribing again
        await d.setSubscription('u-maya', 'i1', true)
        expect(await d.subscription('u-maya', 'i1')).toEqual({ subscribed: true, reason: 'review-requested' })
        // someone who can't see it can't subscribe
        expect(await d.setSubscription('u-sam', 'i1', true)).toMatchObject({ ok: false, error: { code: 'not_found' } })
      })

      test('a queue’s worth of notifications lands as each would alone; a bad one doesn’t lose the rest', async () => {
        const d = await people()
        await d.registerIdea(idea('i1'))
        await d.registerIdea(idea('i2'))
        await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, { edit: false, share: false })
        await d.notify([
          { idea: 'i1', events: [event('comment', me('u-maya'))] },
          { idea: 'i1', events: [event('reply', me('u-riley'))] },
          { idea: 'i2', events: [event('version', me('u-sam'))] },
          { idea: 'nope', events: [event('version', me('u-sam'))] },
        ])
        // maya took part in the first, so she hears of the second
        expect(await ids(d, 'u-maya')).toEqual([['i1', 'participating', 1]])
        expect((await ids(d, 'u-riley')).toSorted()).toEqual([
          ['i1', 'author', 1],
          ['i2', 'author', 1],
        ])
        // one that can't be written (its detail isn't JSON) fails alone
        await expect(
          d.notify([
            { idea: 'i2', events: [event('comment', me('u-sam'), { n: 1n })] },
            { idea: 'i1', events: [event('version', me('u-sam'))] },
          ]),
        ).rejects.toThrow()
        expect(await ids(d, 'u-maya')).toEqual([['i1', 'participating', 2]])
      })

      test('a batch sent twice (a retried send that got through after all) is written once', async () => {
        const d = await people()
        await d.registerIdea(idea('i1'))
        const batch = { idea: 'i1', events: [event('comment', me('u-maya')), event('reply', me('u-sam'))], id: 'b1' }
        await d.notify(batch)
        await d.notify([batch, { ...batch, id: 'b2' }])
        expect(await ids(d, 'u-riley')).toEqual([['i1', 'author', 4]])
      })

      test('watching a team brings its ideas into your inbox, at your level, without a row written per event', async () => {
        const d = await people()
        const team = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } })
          .value.id
        await d.addMember('u-riley', 'team', team, 'u-maya')
        await d.registerIdea(idea('draft', { team }))
        await d.registerIdea(idea('open', { team, status: 'requesting-review' }))
        await d.registerIdea(idea('done', { team, status: 'closed-accepted' }))
        await d.notify({ idea: 'draft', events: [event('comment', me('u-riley'))] })
        await d.notify({ idea: 'open', events: [event('version', me('u-riley'))] })
        await d.notify({
          idea: 'done',
          events: [event('comment', me('u-riley')), event('status', me('u-riley'), { status: 'closed-accepted' })],
        })
        // participating: nothing
        expect(await d.watch('u-maya', team)).toBe('participating')
        expect(await ids(d, 'u-maya')).toEqual([])

        // active: out of draft, and a closed idea's close
        expect(await d.setWatch('u-maya', 'core', 'active')).toEqual({ ok: true, value: 'active' })
        expect((await ids(d, 'u-maya')).toSorted()).toEqual([
          ['done', 'watching', 1],
          ['open', 'watching', 1],
        ])
        expect(await d.subscription('u-maya', 'open')).toEqual({ subscribed: true, reason: 'watching' })
        expect(await d.subscription('u-maya', 'draft')).toEqual({ subscribed: false, reason: null })
        // nothing was written for her: it's worked out when she reads
        expect((await d.inbox('u-maya')).items.find((r) => r.idea.id === 'done')!.latest.kind).toBe('status')

        // all: drafts too
        await d.setWatch('u-maya', team, 'all')
        expect(await d.unreadCount('u-maya')).toBe(3)
        expect((await d.memberships('u-maya')).teams[0]!.watch).toBe('all')

        // read and done, kept as marks; new events count again
        expect(await d.markInbox('u-maya', ['open'], { read: true })).toBe(1)
        expect(await d.unreadCount('u-maya')).toBe(2)
        await d.markInbox('u-maya', ['draft'], { done: true })
        expect((await ids(d, 'u-maya', { done: true })).map((r) => r[0])).toEqual(['draft'])
        await d.notify({ idea: 'draft', events: [event('comment', me('u-riley'))] })
        expect((await ids(d, 'u-maya', { done: true })).map((r) => r[0])).toEqual([])
        expect((await d.inbox('u-maya')).items.find((r) => r.idea.id === 'draft')!.newCount).toBe(2)
        // her own events don't count
        await d.notify({ idea: 'open', events: [event('comment', me('u-maya'))] })
        expect((await d.inbox('u-maya')).items.find((r) => r.idea.id === 'open')!.newCount).toBe(0)

        // involved directly, the idea's own row wins: no double
        await d.setReviewer('u-riley', 'open', { kind: 'user', id: 'u-maya' }, true)
        expect((await ids(d, 'u-maya')).filter((r) => r[0] === 'open')).toEqual([['open', 'review-requested', 1]])
        // unsubscribed, a watched idea goes quiet
        await d.setSubscription('u-maya', 'draft', false)
        expect((await ids(d, 'u-maya')).map((r) => r[0])).not.toContain('draft')
        // and an outsider watching sees only what they can see
        await d.setWatch('u-outsider', team, 'all')
        expect(await ids(d, 'u-outsider')).toEqual([])
        expect(await d.setWatch('u-maya', 'nope', 'all')).toMatchObject({ ok: false, error: { code: 'not_found' } })
      })

      test('what your bots do reaches you unless you turn it off; losing access hides the idea', async () => {
        const d = await people()
        await d.registerIdea(idea('i1'))
        const bot = { user: 'u-riley', bot: 'planbot', purpose: 'bot-for-me' as const }
        await d.notify({ idea: 'i1', events: [event('comment', bot)] })
        expect(await ids(d, 'u-riley')).toEqual([['i1', 'author', 1]])
        expect(await d.notificationSettings('u-riley')).toEqual({ ownBots: true })
        await d.setNotificationSettings('u-riley', { ownBots: false })
        await d.notify({ idea: 'i1', events: [event('comment', bot)] })
        expect(await ids(d, 'u-riley')).toEqual([['i1', 'author', 1]])

        await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, { edit: false, share: false })
        await d.setSubscription('u-maya', 'i1', true)
        await d.notify({ idea: 'i1', events: [event('version', me('u-riley'))] })
        expect(await d.unreadCount('u-maya')).toBe(1)
        await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, null)
        expect(await ids(d, 'u-maya')).toEqual([])
        expect(await d.unreadCount('u-maya')).toBe(0)
      })
    })
  })
}
