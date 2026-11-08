// ideaf review, status, close and reopen, end to end: asking for reviews,
// verdicts on a version, an objection that stands until it's dismissed, and
// closing and reopening, with the Open and Closed lists.
import { beforeAll, describe, expect, test } from 'bun:test'
import { api, repo, server, token } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`
const repoAs = (name: string, files: Record<string, string> = {}) => repo(files, { token: token(h(name)) })

/** The ideas in riley's open or closed list, once the index has caught up (an idea updates its row shortly after it changes). */
async function listed(state: 'open' | 'closed', idea: string, present: boolean): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    const page = await api(h('riley')).listIdeas({ owner: h('riley'), state })
    if (page.items.some((item) => item.id === idea) === present) {
      return true
    }
    await Bun.sleep(50)
  }
  return false
}

describe('reviews from the cli', () => {
  test('ask, approve, object, dismiss, close and reopen', async () => {
    await Promise.all([api(h('maya')).me({}), api(h('sam')).me({})])
    const riley = await repoAs('riley', { 'plan.md': '# Plan\n\nThe quick brown fox.\n' })
    const { idea } = (await riley.ideaf('start', '--title', 'Reviewed', '--json')).json()

    // out for review, with a note
    expect((await riley.ideaf('status', 'review', '-m', 'ready for eyes')).out).toContain('requesting review')
    expect((await riley.ideaf('status', 'approved')).exit).toBe(2)
    // asking gives them view access
    await expect(api(h('maya')).getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
    expect((await riley.ideaf('review', 'ask', h('maya'), h('sam'))).exit).toBe(0)
    expect((await api(h('maya')).getIdea({ idea })).you.view).toBe(true)

    // the owner can't review their own idea
    expect((await riley.ideaf('review', 'approve')).exit).toBe(2)

    const maya = await repoAs('maya')
    const sam = await repoAs('sam')
    expect((await maya.ideaf('review', 'approve', '--idea', idea, '-m', 'Looks right')).exit).toBe(0)
    expect((await sam.ideaf('review', 'request-changes', '--idea', idea, '-m', 'Which fox?')).exit).toBe(0)

    const shown = await riley.ideaf('review', 'show')
    expect(shown.out).toContain('is requesting review, on v1')
    // in no particular order
    expect(shown.out).toMatch(new RegExp(`Asked to review: .*@${h('maya')}`))
    expect(shown.out).toMatch(new RegExp(`Asked to review: .*@${h('sam')}`))
    expect(shown.out).toMatch(/approved\s+@maya-\w+ · v1 · counts/)
    expect(shown.out).toMatch(/requested changes\s+@sam-\w+ · v1 · stands/)
    expect(shown.out).toContain('An objection stands')

    // a new version: maya's approval no longer counts, sam's objection still stands
    await api(h('riley')).edit({
      idea,
      batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] },
    })
    const reviews = (await riley.ideaf('review', 'show', '--json')).json()
    expect(reviews.reviews.map((r: { counts: boolean; standing: boolean }) => [r.counts, r.standing])).toEqual([
      [false, false],
      [false, true],
    ])

    // it can't close as accepted while the objection stands
    const blocked = await riley.ideaf('close', '--accepted')
    expect(blocked.exit).toBe(12)
    expect(blocked.err).toContain('a reviewer objects')
    expect((await riley.ideaf('review', 'dismiss', h('sam'))).exit).toBe(2)
    expect((await riley.ideaf('review', 'dismiss', h('sam'), '-m', 'Answered in v2')).exit).toBe(0)
    expect((await riley.ideaf('close', '--accepted', '-m', 'Going ahead')).out).toContain('closed as accepted')

    // closed: it's in the closed list, not the open one
    expect(await listed('closed', idea, true)).toBe(true)
    expect(await listed('open', idea, false)).toBe(true)

    // reopened, it's back where it was
    expect((await riley.ideaf('reopen')).out).toContain('requesting review')
    const status = (await riley.ideaf('status', '--json')).json()
    expect(status.history.map((c: { status: string }) => c.status)).toEqual([
      'draft',
      'requesting-review',
      'closed-accepted',
      'requesting-review',
    ])
  })
})
