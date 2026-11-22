// The inbox, end to end: an idea's events go from its actor through the
// directory's queue into the inboxes of those who hear about it, one row per
// idea; read, done, unsubscribing, and what your bots do; and by email.
import { beforeAll, describe, expect, test } from 'bun:test'
import { testEmail } from '@ideaf/server/testing.ts'
import { api, repo, server, token } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`
const repoAs = (name: string, files: Record<string, string> = {}) => repo(files, { token: token(h(name)) })

/** Someone's inbox, once the queue has caught up and `ready` says it has. */
async function inboxOf(name: string, ready: (items: Items) => boolean, filter = {}): Promise<Items> {
  let items: Items = []
  for (let i = 0; i < 60; i++) {
    items = (await api(h(name)).listNotifications(filter)).items.flatMap((n) => (n.kind === 'idea' ? [n] : []))
    if (ready(items)) {
      return items
    }
    await Bun.sleep(50)
  }
  return items
}
type Items = Array<
  Extract<Awaited<ReturnType<ReturnType<typeof api>['listNotifications']>>['items'][number], { kind: 'idea' }>
>

describe('the inbox', () => {
  test('one row per idea: asked to review, then what others do, read and done', async () => {
    await Promise.all([api(h('maya')).me({}), api(h('sam')).me({})])
    const riley = await repoAs('riley', { 'plan.md': '# Plan\n\nThe quick brown fox.\n' })
    const { idea } = (await riley.ideaf('start', '--title', 'Inbox plan', '--json')).json()
    await riley.ideaf('review', 'ask', h('maya'))

    // maya hears she's been asked
    let maya = await inboxOf('maya', (items) => items.length > 0)
    expect(maya).toMatchObject([
      {
        idea: { id: idea, title: 'Inbox plan' },
        reason: 'review-requested',
        newCount: 1,
        latest: { kind: 'requested' },
      },
    ])
    expect((await api(h('maya')).unreadNotifications({})).count).toBe(1)

    // she comments: riley hears of it, she doesn't of her own
    await api(h('maya')).addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Which fox?' })
    const rileys = await inboxOf('riley', (items) => items.length > 0)
    expect(rileys).toMatchObject([
      { reason: 'author', newCount: 1, latest: { kind: 'comment', detail: { body: 'Which fox?' } } },
    ])
    const shown = await riley.ideaf('inbox', 'show')
    expect(shown.out).toMatch(new RegExp(`● 1 new +${idea} +/@${h('riley')}/idea/1 +Inbox plan +\\(author\\)`))
    expect(shown.out).toContain(`@${h('maya')} commented: Which fox?`)

    // riley makes a version and replies: still one row for maya, with two new
    await api(h('riley')).edit({
      idea,
      batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] },
    })
    await api(h('riley')).reply({ idea, comment: 'c1', body: 'The slow one.' })
    maya = await inboxOf('maya', (items) => items[0]?.newCount === 3)
    expect(maya).toMatchObject([{ newCount: 3, latest: { kind: 'reply' } }])

    // read, then done: gone until something new
    const m = await repoAs('maya')
    expect((await m.ideaf('inbox', 'read', idea)).out).toContain('1 idea marked read')
    expect((await api(h('maya')).unreadNotifications({})).count).toBe(0)
    // done, as one section of her inbox grouped by team: riley's ideas outside any team
    expect((await m.ideaf('inbox', 'done', '--all', '--owner', h('riley'))).exit).toBe(2)
    expect((await m.ideaf('inbox', 'done', '--owner', h('riley'))).out).toContain('1 notification marked done')
    expect((await api(h('maya')).listNotifications({})).items).toEqual([])
    expect((await m.ideaf('inbox', 'show', '--done')).out).toContain(idea)
    await api(h('riley')).reply({ idea, comment: 'c1', body: 'Or the brown one.' })
    maya = await inboxOf('maya', (items) => items.length > 0)
    expect(maya).toMatchObject([{ newCount: 1, done: false }])

    // unsubscribed, she hears nothing more
    expect((await m.ideaf('unsubscribe', '--idea', idea)).out).toContain('won’t hear about')
    await m.ideaf('inbox', 'read', '--all')
    await api(h('riley')).reply({ idea, comment: 'c1', body: 'Final answer.' })
    await Bun.sleep(400)
    expect((await api(h('maya')).unreadNotifications({})).count).toBe(0)
  })

  test('a notice when your group joins a team: in the inbox among the ideas, read and done as a row', async () => {
    await api(h('ines')).me({})
    const team = h('noticed')
    const group = h('reviewers')
    await api(h('riley')).createTeam({ handle: team, name: 'Noticed' })
    await api(h('ines')).createGroup({ handle: group, name: 'Reviewers' })
    await api(h('riley')).addTeamGroup({ team, group })
    const all = async () => (await api(h('ines')).listNotifications({ reason: 'teams' })).items
    let notices = await all()
    for (let i = 0; i < 60 && notices.length === 0; i++) {
      await Bun.sleep(50)
      notices = await all()
    }
    expect(notices).toMatchObject([
      {
        kind: 'notice',
        reason: 'teams',
        newCount: 1,
        notice: {
          kind: 'group-joined',
          as: 'group-admin',
          team: { handle: team, name: 'Noticed' },
          group: { handle: group, name: 'Reviewers' },
          role: 'member',
        },
      },
    ])
    expect((await api(h('ines')).countNotifications({})).reasons.teams).toBe(1)
    expect((await api(h('ines')).unreadNotifications({})).count).toBe(1)
    const id = notices[0]!.kind === 'notice' ? notices[0]!.id : ''
    // and by email, once it's quiet: its own, in her words
    let mail = testEmail.to(`${h('ines')}@example.test`)
    for (let i = 0; i < 300 && mail.length === 0; i++) {
      await Bun.sleep(50)
      mail = testEmail.to(`${h('ines')}@example.test`)
    }
    expect(mail.map((m) => m.subject)).toEqual(['[Noticed] The Reviewers group joined Noticed, as members'])
    expect(mail[0]!.text).toContain(`added your group to Noticed`)
    expect(mail[0]!.headers).toMatchObject({ 'X-Ideaf-Reason': 'teams', 'X-Ideaf-Team': team, 'X-Ideaf-Group': group })
    // in the cli: the notice's ID (to mark it), its team, what happened, and who did it, in her words
    const ines = await repoAs('ines')
    const shown = (await ines.ideaf('inbox', 'show', '--reason', 'teams')).out
    expect(shown).toMatch(
      new RegExp(`● new +${id} +${team} +The Reviewers group joined Noticed, as members +\\(group admin\\)`),
    )
    expect(shown).toContain(`@${h('riley')} added your group to Noticed`)
    expect((await ines.ideaf('inbox', 'read', id)).out).toContain('1 notification marked read')
    expect((await api(h('ines')).unreadNotifications({})).count).toBe(0)
    // its group's section can't be marked with ideas by ID too
    await expect(api(h('ines')).markNotifications({ notices: [id], group, done: true })).rejects.toThrow()
    expect((await api(h('ines')).markNotifications({ team, done: true })).changed).toBe(1)
    expect(await all()).toEqual([])
  })

  // what a bot acting for you does is covered by the directory's contract tests; here, the setting
  test('whether your bots’ actions reach you is a setting, on by default', async () => {
    const lee = await repoAs('lee')
    expect((await lee.ideaf('inbox', 'settings')).out).toContain('lands in your inbox')
    expect((await lee.ideaf('inbox', 'settings', '--no-own-bots')).out).toContain('stays out of your inbox')
    expect(await api(h('lee')).getNotificationSettings({})).toMatchObject({ ownBots: false })
  })

  test('watching a team: its active ideas join your inbox, at the level you pick', async () => {
    await api(h('kim')).me({})
    const riley = await repoAs('riley', { 'plan.md': '# Plan\n\nText.\n' })
    const team = h('watched')
    expect((await riley.ideaf('team', 'create', team, '--name', 'Watched')).exit).toBe(0)
    expect((await riley.ideaf('team', 'add', team, h('kim'))).exit).toBe(0)
    const { idea } = (await riley.ideaf('start', '--title', 'Team plan', '--team', team, '--json')).json()
    await riley.ideaf('status', 'review')

    const kim = await repoAs('kim')
    expect((await kim.ideaf('team', 'watch', team)).out).toContain('only the ideas you’re involved in')
    expect((await kim.ideaf('team', 'watch', team, 'everything')).exit).toBe(2)
    expect((await kim.ideaf('team', 'watch', team, 'active')).out).toContain('every idea once it’s out of draft')
    expect((await api(h('kim')).myMemberships({})).teams.find((t) => t.handle === team)?.watch).toBe('active')

    // riley comments: kim hears of it through the team
    await api(h('riley')).addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Ready?' })
    const items = await inboxOf('kim', (i) => i.some((n) => n.idea.id === idea))
    expect(items.find((n) => n.idea.id === idea)).toMatchObject({ reason: 'watching', latest: { kind: 'comment' } })
    expect((await kim.ideaf('inbox', 'show', '--reason', 'watching')).out).toContain('(watching a team)')
    expect((await kim.ideaf('inbox', 'show', '--team', team)).out).toContain(idea)
    // the team's section, read as a whole
    // (the idea, and the notice that riley added her to the team)
    expect((await kim.ideaf('inbox', 'read', '--team', team)).out).toContain('2 notifications marked read')
    expect((await api(h('kim')).unreadNotifications({})).count).toBe(0)
  })

  // its own waits (the inbox, the email's quiet period, the email) can add up to more than the default 5 s
  test('by email: an idea’s updates in one email once it’s quiet, unless read first; one click unsubscribes', async () => {
    await Promise.all([api(h('ash')).me({}), api(h('kai')).me({})])
    const riley = await repoAs('riley', { 'plan.md': '# Plan\n\nText.\n' })
    const { idea } = (await riley.ideaf('start', '--title', 'Mailed plan', '--json')).json()
    await api(h('riley')).setAccess({
      idea,
      subject: { kind: 'user', id: h('kai') },
      access: { edit: false, share: false },
    })
    await api(h('kai')).setSubscription({ idea, subscribed: true })
    await riley.ideaf('review', 'ask', h('ash'))
    await api(h('riley')).addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Thoughts?' })

    // kai reads it in the app before its email goes: none comes
    await inboxOf('kai', (items) => items.length > 0)
    await api(h('kai')).markNotifications({ ideas: [idea], read: true })

    // ash gets one email: asked to review, and the comment
    const ash = `${h('ash')}@example.test`
    let mail = testEmail.to(ash)
    // due 300 ms after the comment; a few seconds more should its alarm be lost to busy storage (scheduleEmails)
    for (let i = 0; i < 300 && mail.length === 0; i++) {
      await Bun.sleep(50)
      mail = testEmail.to(ash)
    }
    expect(mail).toHaveLength(1)
    const [email] = mail
    expect(email!.subject).toMatch(new RegExp(`^\\[@${h('riley')}\\] Mailed plan \\(@${h('riley')}/idea/\\d+\\)$`))
    expect(email!.text).toContain('asked you to review it')
    expect(email!.text).toContain('commented:\n> Thoughts?')
    expect(email!.headers['X-Ideaf-Reason']).toBe('review-requested')
    await Bun.sleep(500)
    expect(testEmail.to(`${h('kai')}@example.test`)).toEqual([])

    // its unsubscribe link works without signing in
    const link = email!.headers['List-Unsubscribe']!.slice(1, -1)
    const app = await server()
    expect(await (await app(new Request(link))).text()).toContain('Unsubscribe from “Mailed plan”?')
    expect((await app(new Request(link, { method: 'POST', body: 'List-Unsubscribe=One-Click' }))).status).toBe(200)
    expect(await api(h('ash')).getSubscription({ idea })).toEqual({ subscribed: false, reason: null })
  }, 20_000)

  test('email settings, from the cli', async () => {
    const lee = await repoAs('lee')
    expect((await lee.ideaf('inbox', 'settings')).out).toContain('Email: everything your inbox has')
    const set = await lee.ideaf(
      'inbox',
      'settings',
      '--email',
      'review-requests',
      '--email-watching',
      '--cadence',
      'daily',
    )
    expect(set.out).toContain('only when you’re asked to review')
    expect(set.out).toContain('The teams you watch email you too')
    expect(set.out).toContain('One digest a day')
    expect((await lee.ideaf('inbox', 'settings', '--email', 'sometimes')).exit).toBe(2)
    expect(await api(h('lee')).getNotificationSettings({})).toEqual({
      ownBots: false,
      email: 'review-requests',
      emailWatching: true,
      cadence: 'daily',
      emailAvailable: true,
    })
  })
})
