// The tests every Directory implementation must pass: the directory actor's
// SQLite now, Postgres if it's added. Each implementation's test file calls
// directoryContract with a way to make an empty directory.
import { describe, expect, test } from 'bun:test'
import type { Directory, IdeaRow, MovePreview } from './types.ts'

export function directoryContract(name: string, make: () => Promise<Directory>): void {
  async function people() {
    const d = await make()
    for (const handle of ['riley', 'maya', 'sam', 'devon', 'outsider']) await d.ensureUser({ id: `u-${handle}`, handle, name: handle[0]!.toUpperCase() + handle.slice(1) })
    return d
  }
  let clock = 1_000_000
  const idea = (id: string, extra: Partial<IdeaRow> = {}): IdeaRow => ({
    id,
    title: `Idea ${id}`,
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
    })

    describe('teams and groups', () => {
      test('the creator is the first admin; handles are validated and unique', async () => {
        const d = await people()
        const team = await d.createTeam('u-riley', { handle: 'Platform', name: 'Platform' })
        expect(team).toMatchObject({ ok: true, value: { kind: 'team', handle: 'platform', members: 1, createPolicy: 'members', defaults: { members: 'view', public: false, groups: [] } } })
        expect((await d.members('team', (team as { value: { id: string } }).value.id)).items).toEqual([{ user: expect.objectContaining({ handle: 'riley' }), role: 'admin' }])
        expect(await d.createTeam('u-maya', { handle: 'platform', name: 'Again' })).toMatchObject({ ok: false, error: { code: 'exists' } })
        expect(await d.createTeam('u-maya', { handle: '-bad-', name: 'Bad' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
        expect(await d.createGroup('u-maya', { handle: 'platform', name: 'A group can share a team’s handle' })).toMatchObject({ ok: true })
        expect((await d.team('platform'))!.id).toBe((await d.team((team as { value: { id: string } }).value.id))!.id)
      })

      test('creating the same team at once: one wins, the others are told it exists', async () => {
        const d = await people()
        const results = await Promise.all(['u-riley', 'u-maya', 'u-sam'].map((u) => d.createTeam(u, { handle: 'race', name: 'Race' })))
        expect(results.filter((r) => r.ok)).toHaveLength(1)
        expect(results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error.code))).toEqual(['exists', 'exists'])
      })

      test('lists are paged with cursors, and searchable', async () => {
        const d = await people()
        for (let i = 0; i < 30; i++) await d.createTeam('u-riley', { handle: `team-${String(i).padStart(2, '0')}`, name: `Team ${i}` })
        const first = await d.teams({ limit: 25 })
        expect(first.items).toHaveLength(25)
        const second = await d.teams({ limit: 25, cursor: first.next! })
        expect(second.items.map((t) => t.handle)).toEqual(['team-25', 'team-26', 'team-27', 'team-28', 'team-29'])
        expect(second.next).toBeNull()
        expect((await d.teams({ query: 'team-1' })).items).toHaveLength(10)
      })

      test('maintainers add members; only admins give roles or change settings', async () => {
        const d = await people()
        const { id } = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } }).value
        expect(await d.addMember('u-riley', 'team', id, 'u-maya', 'maintainer')).toMatchObject({ ok: true })
        expect(await d.addMember('u-maya', 'team', id, 'u-sam')).toMatchObject({ ok: true, value: { role: 'member' } })
        expect(await d.addMember('u-maya', 'team', id, 'u-devon', 'admin')).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.addMember('u-sam', 'team', id, 'u-devon')).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.updateTeam('u-maya', id, { createPolicy: 'anyone' })).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.updateTeam('u-riley', id, { createPolicy: 'maintainers', defaults: { members: 'edit', public: true, groups: [] } })).toMatchObject({
          ok: true,
          value: { createPolicy: 'maintainers', defaults: { members: 'edit', public: true } },
        })
      })

      test('removing and leaving; a team always keeps an admin', async () => {
        const d = await people()
        const { id } = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } }).value
        await d.addMember('u-riley', 'team', id, 'u-maya', 'maintainer')
        await d.addMember('u-riley', 'team', id, 'u-sam')
        expect(await d.removeMember('u-maya', 'team', id, 'u-riley')).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.removeMember('u-maya', 'team', id, 'u-sam')).toEqual({ ok: true, value: null })
        expect(await d.removeMember('u-riley', 'team', id, 'u-riley')).toMatchObject({ ok: false, error: { code: 'invalid', message: expect.stringContaining('at least one admin') } })
        expect(await d.removeMember('u-maya', 'team', id, 'u-maya')).toEqual({ ok: true, value: null })
        expect((await d.team(id))!.members).toBe(1)
      })

      test('joining is by request, approved or denied by a maintainer or admin', async () => {
        const d = await people()
        const { id } = ((await d.createGroup('u-riley', { handle: 'security', name: 'Security' })) as { value: { id: string } }).value
        expect(await d.requestToJoin('u-sam', 'group', id)).toEqual({ ok: true, value: { requested: true } })
        expect(await d.requestToJoin('u-sam', 'group', id)).toEqual({ ok: true, value: { requested: true } })
        await d.requestToJoin('u-devon', 'group', id)
        expect(await d.joinRequests('u-sam', 'group', id)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(((await d.joinRequests('u-riley', 'group', id)) as { value: Array<{ handle: string }> }).value.map((u) => u.handle).toSorted()).toEqual(['devon', 'sam'])
        expect(await d.decide('u-riley', 'group', id, 'u-sam', true)).toEqual({ ok: true, value: null })
        expect(await d.decide('u-riley', 'group', id, 'u-devon', false)).toEqual({ ok: true, value: null })
        expect((await d.members('group', id)).items.map((m) => m.user.handle)).toEqual(['riley', 'sam'])
        expect(((await d.joinRequests('u-riley', 'group', id)) as { value: unknown[] }).value).toEqual([])
      })
    })

    describe('access', () => {
      async function withTeam() {
        const d = await people()
        const team = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } }).value.id
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
        expect(await d.grants('i1')).toEqual([{ subject: { kind: 'team', id: team }, edit: false, share: false }])
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
        const group = ((await d.createGroup('u-devon', { handle: 'security', name: 'Security' })) as { value: { id: string } }).value.id
        await d.registerIdea(idea('i1'))
        expect(await d.setGrant('u-maya', 'i1', { kind: 'user', id: 'u-maya' }, { edit: true, share: true })).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-maya' }, { edit: true, share: false })).toMatchObject({ ok: true })
        expect(await d.permission('i1', 'u-maya')).toEqual({ view: true, edit: true, share: false, owner: false })
        expect(await d.setGrant('u-riley', 'i1', { kind: 'group', id: group }, { edit: false, share: false })).toMatchObject({ ok: true })
        expect((await d.permission('i1', 'u-devon')).view).toBe(true)
        expect(await d.setGrant('u-riley', 'i1', { kind: 'everyone' }, { edit: true, share: false })).toMatchObject({ ok: false, error: { code: 'invalid' } })
        expect(await d.setGrant('u-riley', 'i1', { kind: 'everyone' }, { edit: false, share: false })).toMatchObject({ ok: true })
        expect(await d.permission('i1', 'u-outsider')).toEqual({ view: true, edit: false, share: false, owner: false })
        expect(await d.setGrant('u-riley', 'i1', { kind: 'user', id: 'u-riley' }, { edit: false, share: false })).toMatchObject({ ok: false, error: { code: 'invalid' } })
        // removing a grant
        await d.setGrant('u-riley', 'i1', { kind: 'everyone' }, null)
        expect((await d.permission('i1', 'u-outsider')).view).toBe(false)
      })
    })

    describe('moving an idea (the move wizard)', () => {
      test('the preview says who loses and gains access; nothing changes until the move', async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } }).value.id
        const web = ((await d.createTeam('u-devon', { handle: 'web', name: 'Web' })) as { value: { id: string } }).value.id
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

        const moved = await d.moveIdea('u-riley', 'i1', web)
        expect(moved.ok).toBe(true)
        expect((await d.idea('i1'))!.team).toBe(web)
        expect((await d.permission('i1', 'u-maya')).view).toBe(false)
        expect((await d.permission('i1', 'u-sam')).view).toBe(true)
      })

      test('moving needs share access, and permission to create ideas in the new team', async () => {
        const d = await people()
        const core = ((await d.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } }).value.id
        const closed = ((await d.createTeam('u-devon', { handle: 'closed', name: 'Closed' })) as { value: { id: string } }).value.id
        await d.addMember('u-riley', 'team', core, 'u-maya')
        await d.registerIdea(idea('i1', { team: core, owner: 'u-riley' }))
        expect(await d.moveIdea('u-maya', 'i1', null)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.moveIdea('u-riley', 'i1', closed)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(await d.moveIdea('u-outsider', 'i1', null)).toMatchObject({ ok: false, error: { code: 'not_found' } })
        // out of a team: private to its owner again
        expect(await d.moveIdea('u-riley', 'i1', null)).toMatchObject({ ok: true, value: { to: null, losing: { count: 1 } } })
        expect(await d.grants('i1')).toEqual([])
      })
    })

    describe('the idea index', () => {
      test('lists only what you can see, newest first, paged with cursors', async () => {
        const { d, team } = await (async () => {
          const dir = await people()
          const t = ((await dir.createTeam('u-riley', { handle: 'core', name: 'Core' })) as { value: { id: string } }).value.id
          await dir.addMember('u-riley', 'team', t, 'u-maya')
          return { d: dir, team: t }
        })()
        for (let i = 0; i < 30; i++) await d.registerIdea(idea(`team-${i}`, { team }))
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

      test('updates keep the row current, and an older update never overwrites a newer one', async () => {
        const d = await people()
        await d.registerIdea(idea('i1', { updatedAt: 100 }))
        await d.updateIdea({ id: 'i1', title: 'Newer', status: 'requesting-review', latest: 3, updatedAt: 300 })
        await d.updateIdea({ id: 'i1', title: 'Older', status: 'draft', latest: 2, updatedAt: 200 })
        expect(await d.idea('i1')).toMatchObject({ title: 'Newer', status: 'requesting-review', latest: 3, updatedAt: 300 })
      })

      test('search finds text anywhere in a title, ranks closer matches first, and respects access', async () => {
        const d = await people()
        await d.registerIdea(idea('a', { title: 'Offline-first sync for the field app' }))
        await d.registerIdea(idea('b', { title: 'Sync' }))
        await d.registerIdea(idea('c', { title: 'Billing: online invoices' }))
        await d.registerIdea(idea('hidden', { title: 'Sync secrets', owner: 'u-maya' }))
        expect((await d.searchIdeas('u-riley', 'sync')).map((i) => i.id)).toEqual(['b', 'a'])
        expect((await d.searchIdeas('u-riley', 'line')).map((i) => i.id).toSorted()).toEqual(['a', 'c'])
        expect((await d.searchIdeas('u-maya', 'sync')).map((i) => i.id)).toEqual(['hidden'])
        // under three characters: from the start of a word
        expect((await d.searchIdeas('u-riley', 'of')).map((i) => i.id)).toEqual(['a'])
        expect((await d.searchIdeas('u-riley', 'in')).map((i) => i.id)).toEqual(['c'])
        // renaming updates search
        await d.updateIdea({ id: 'b', title: 'Replication', status: 'draft', latest: 2, updatedAt: clock++ })
        expect((await d.searchIdeas('u-riley', 'sync')).map((i) => i.id)).toEqual(['a'])
      })
    })
  })
}
