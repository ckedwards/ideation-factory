// Sharing, moving and teams from the cli, with several people, against the
// real server.
import { beforeAll, describe, expect, test } from 'bun:test'
import { api, repo, server, token } from './harness.ts'

beforeAll(() => server(), 60_000)

// each run uses fresh handles, so runs never collide
const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`
/** A repository where `ideaf` runs as this person. */
const repoAs = (name: string, files: Record<string, string> = {}) => repo(files, { token: token(h(name)) })

const PLAN = '# Plan\n\nThe quick brown fox.\n'

/** An idea riley started, in riley's repository. */
async function rileysIdea(title: string) {
  const r = await repoAs('riley', { 'plan.md': PLAN })
  const { idea } = (await r.ideaf('start', '--title', title, '--json')).json()
  return { r, idea: idea as string }
}

describe('ideaf share', () => {
  test('shows who has access, and gives it to people and groups', async () => {
    await api(h('maya')).me({})
    const security = await api(h('devon')).createGroup({ handle: h('security'), name: 'Security' })
    const { r, idea } = await rileysIdea('Shared plan')

    const fresh = await r.ideaf('share', '--json')
    expect(fresh.exit).toBe(0)
    expect(fresh.json()).toMatchObject({ idea, owner: { handle: h('riley') }, you: { owner: true }, grants: [] })
    expect((await r.ideaf('share')).out).toContain('Not shared with anyone.')

    // a person, by handle with or without @, and a group
    const gave = await r.ideaf('share', `@${h('maya')}`, '--edit')
    expect(gave.exit).toBe(0)
    expect(gave.out).toContain(`@${h('maya')} can now view and edit it.`)
    expect((await api(h('maya')).getAccess({ idea })).you).toMatchObject({ view: true, edit: true, share: false })
    expect((await r.ideaf('share', `group:${h('security')}`, '--json')).json().grants).toContainEqual({
      who: `group:${h('security')}`,
      subject: { kind: 'group', id: security.id },
      reviewer: false,
      edit: false,
      share: false,
    })

    const shown = await r.ideaf('share')
    expect(shown.out).toContain(`Owner: @${h('riley')}`)
    expect(shown.out).toMatch(new RegExp(`@${h('maya')} +view, edit`))
    expect(shown.out).toMatch(new RegExp(`group:${h('security')} +view`))
  })

  test('makes an idea public and not, and removes access', async () => {
    await api(h('maya')).me({})
    const { r, idea } = await rileysIdea('Public plan')
    expect((await r.ideaf('share', 'everyone', '--edit')).exit).toBe(2)
    expect((await r.ideaf('share', 'everyone')).out).toContain('Everyone can now view it.')
    expect((await api(h('outsider')).getAccess({ idea })).you.view).toBe(true)
    expect((await r.ideaf('share', 'everyone', '--remove')).out).toContain("It's no longer public.")

    await r.ideaf('share', h('maya'))
    expect((await r.ideaf('share', h('maya'), '--remove')).out).toContain(`Removed @${h('maya')}'s access.`)
    await expect(api(h('maya')).getAccess({ idea })).rejects.toMatchObject({ code: 'not_found' })
    expect((await r.ideaf('share', h('maya'), '--remove')).out).toContain('had no access of their own')
  })

  test('refuses mistakes, and people without share access', async () => {
    const { r, idea } = await rileysIdea('Guarded plan')
    expect((await r.ideaf('share', h('nobody'))).exit).toBe(5)
    expect((await r.ideaf('share', 'squad:x')).exit).toBe(2)
    expect((await r.ideaf('share', h('maya'), '--edit', '--remove')).exit).toBe(2)

    await api(h('riley')).setAccess({
      idea,
      subject: { kind: 'user', id: h('maya') },
      access: { edit: false, share: false },
    })
    const maya = await repoAs('maya')
    expect((await maya.ideaf('share', '--idea', idea, h('devon'))).exit).toBe(6)
    expect((await maya.ideaf('share', '--idea', idea)).out).toContain('You can view it.')
  })
})

describe('ideaf move', () => {
  test('previews who loses and gains access, asks for --yes, and moves', async () => {
    await Promise.all([api(h('maya')).me({}), api(h('sam')).me({})])
    const r = await repoAs('riley', { 'plan.md': PLAN })
    expect((await r.ideaf('team', 'create', h('from'), '--name', 'From')).exit).toBe(0)
    expect((await r.ideaf('team', 'create', h('to'), '--name', 'To')).exit).toBe(0)
    expect((await r.ideaf('team', 'add', h('from'), h('maya'))).exit).toBe(0)
    expect((await r.ideaf('team', 'add', h('to'), h('sam'))).exit).toBe(0)
    const { idea } = (await r.ideaf('start', '--title', 'Moving', '--team', h('from'), '--json')).json()

    // without a terminal, it won't move without --yes, but says what would happen
    const unconfirmed = await r.ideaf('move', '--team', h('to'))
    expect(unconfirmed.exit).toBe(2)
    expect(unconfirmed.err).toContain('--yes')
    expect(unconfirmed.out).toContain(`Moving from team:${h('from')} to team:${h('to')}.`)
    expect(unconfirmed.out).toContain(`Losing access (1): @${h('maya')}.`)
    expect(unconfirmed.out).toContain(`Gaining access (1): @${h('sam')}.`)
    expect(unconfirmed.out).toContain(`Adjust with --keep team:${h('from')}, --skip team:${h('to')}.`)
    const asJson = await r.ideaf('move', '--team', h('to'), '--json')
    expect(asJson.exit).toBe(2)
    expect(asJson.json().error).toMatchObject({ code: 'confirm', details: { losing: { count: 1 } } })

    // a dry run, with the old team's access kept
    const kept = await r.ideaf('move', '--team', h('to'), '--keep', `team:${h('from')}`, '--dry-run', '--json')
    expect(kept.exit).toBe(0)
    expect(kept.json()).toMatchObject({ moved: false, losing: { count: 0 } })
    expect(
      kept
        .json()
        .grants.after.map((g: { who: string }) => g.who)
        .sort(),
    ).toEqual([`team:${h('from')}`, `team:${h('to')}`].sort())
    expect((await api(h('maya')).getIdea({ idea })).title).toBe('Moving')

    const moved = await r.ideaf('move', '--team', h('to'), '--yes', '--json')
    expect(moved.exit).toBe(0)
    expect(moved.json()).toMatchObject({ moved: true, to: expect.any(String) })
    await expect(api(h('maya')).getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
    expect((await api(h('sam')).getIdea({ idea })).title).toBe('Moving')

    // out of its team: private to its owner
    const out = await r.ideaf('move', '--out', '-y')
    expect(out.exit).toBe(0)
    expect(out.out).toContain('Moved out of its team.')
    await expect(api(h('sam')).getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
    expect((await r.ideaf('move', '--out', '--json')).json()).toMatchObject({ moved: false })

    expect((await r.ideaf('move')).exit).toBe(2)
    expect((await r.ideaf('move', '--team', h('to'), '--out')).exit).toBe(2)
  })
})

describe('ideaf team and ideaf group', () => {
  test('create, join by request, members, settings and leaving', async () => {
    const riley = await repoAs('riley')
    const sam = await repoAs('sam')
    const team = h('platform')

    const created = await riley.ideaf('team', 'create', `@${team}`, '--name', 'Platform', '--json')
    expect(created.exit).toBe(0)
    expect(created.json()).toMatchObject({ handle: team, members: 1 })
    expect((await riley.ideaf('team', 'create', team)).exit).toBe(2) // no name
    expect((await riley.ideaf('team', 'list', team)).out).toContain(`team:${team}`)
    expect((await riley.ideaf('team', 'show', team)).out).toContain('Ideas can be created by its members.')

    // joining is by request
    expect((await sam.ideaf('team', 'join', team)).out).toContain(`Asked to join team:${team}`)
    const waiting = await riley.ideaf('team', 'requests', team)
    expect(waiting.out).toContain(`@${h('sam')}`)
    expect((await riley.ideaf('team', 'approve', team, h('sam'))).out).toContain(`Let @${h('sam')} into team:${team}.`)
    expect((await riley.ideaf('team', 'requests', team)).out).toContain('No one is waiting')
    const members = (await riley.ideaf('team', 'members', team, '--json')).json()
    expect(members.items.map((m: { user: { handle: string }; role: string }) => [m.user.handle, m.role])).toEqual([
      [h('riley'), 'admin'],
      [h('sam'), 'member'],
    ])
    expect((await riley.ideaf('team', 'add', team, h('sam'), '--role', 'maintainer')).out).toContain(
      `@${h('sam')} is a maintainer of team:${team}.`,
    )
    expect((await riley.ideaf('team', 'add', team, h('sam'), '--role', 'boss')).exit).toBe(2)

    // settings: what new ideas start with
    const group = h('reviewers')
    expect((await riley.ideaf('group', 'create', group, '--name', 'Reviewers')).exit).toBe(0)
    const set = await riley.ideaf(
      'team',
      'settings',
      team,
      '--members',
      'edit',
      '--public',
      '--create',
      'maintainers',
      '--group',
      `${group}=edit`,
    )
    expect(set.exit).toBe(0)
    expect(set.out).toContain('Ideas can be created by its maintainers and admins.')
    expect(set.out).toContain('its members: edit')
    expect(set.out).toContain('everyone: view (public)')
    expect(set.out).toContain(`group:${group} edit`)
    const removed = (await riley.ideaf('team', 'settings', team, '--remove-group', group, '--private', '--json')).json()
    expect(removed.defaults).toEqual({ members: 'edit', public: false, groups: [] })
    expect((await riley.ideaf('team', 'settings', team, '--members', 'all')).exit).toBe(2)
    expect((await sam.ideaf('team', 'settings', team, '--public')).exit).toBe(6)

    // leaving, and removing someone
    expect((await sam.ideaf('team', 'leave', team)).out).toContain(`You left team:${team}.`)
    expect((await riley.ideaf('team', 'members', team, '--json')).json().items).toHaveLength(1)
    expect((await riley.ideaf('group', 'add', group, h('sam'))).exit).toBe(0)
    expect((await riley.ideaf('group', 'remove', group, h('sam'))).out).toContain(`Removed @${h('sam')}`)
    expect((await riley.ideaf('group', 'show', group)).out).toContain('1 member')
  })

  test('usage mistakes and help', async () => {
    const r = await repoAs('riley')
    expect((await r.ideaf('team')).out).toContain('ideaf team <command>')
    expect((await r.ideaf('team', 'nope')).exit).toBe(2)
    const missing = await r.ideaf('team', 'add', 'core')
    expect(missing.exit).toBe(2)
    expect(missing.err).toContain('missing person')
    expect((await r.ideaf('team', 'show', 'a', 'b')).exit).toBe(2)
    expect((await r.ideaf('team', 'show', h('none'))).exit).toBe(5)
    expect((await r.ideaf('team', 'settings', '--help')).out).toContain('--remove-group')
    expect((await r.ideaf('help', 'group', 'join')).out).toContain('Usage: ideaf group join <group>')
    const top = (await r.ideaf('--help')).out
    for (const name of ['share', 'move', 'team', 'group']) {
      expect(top).toContain(`  ${name} `)
    }
  })
})
