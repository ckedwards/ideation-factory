// The inbox, end to end: an idea's events go from its actor through the
// directory's queue into the inboxes of those who hear about it, one row per
// idea; read, done, unsubscribing, and what your bots do.
import { beforeAll, describe, expect, test } from 'bun:test'
import { api, repo, server, token } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`
const repoAs = (name: string, files: Record<string, string> = {}) => repo(files, { token: token(h(name)) })

/** Someone's inbox, once the queue has caught up and `ready` says it has. */
async function inboxOf(name: string, ready: (items: Items) => boolean, filter = {}): Promise<Items> {
  let items: Items = []
  for (let i = 0; i < 60; i++) {
    items = (await api(h(name)).listNotifications(filter)).items
    if (ready(items)) {
      return items
    }
    await Bun.sleep(50)
  }
  return items
}
type Items = Awaited<ReturnType<ReturnType<typeof api>['listNotifications']>>['items']

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
    await m.ideaf('inbox', 'done', '--all')
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

  // what a bot acting for you does is covered by the directory's contract tests; here, the setting
  test('whether your bots’ actions reach you is a setting, on by default', async () => {
    const lee = await repoAs('lee')
    expect((await lee.ideaf('inbox', 'settings')).out).toContain('lands in your inbox')
    expect((await lee.ideaf('inbox', 'settings', '--no-own-bots')).out).toContain('stays out of your inbox')
    expect(await api(h('lee')).getNotificationSettings({})).toEqual({ ownBots: false })
  })
})
