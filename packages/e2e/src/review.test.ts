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
    // pulling it says which version she's seen; sam hasn't opened it
    expect(await maya.ideaf('pull', '--idea', idea)).toMatchObject({ exit: 0 })
    const seen = (await riley.ideaf('review', 'show')).out
    expect(seen).toMatch(new RegExp(`@${h('maya')}[^,]* · seen v1`))
    expect(seen).toMatch(new RegExp(`@${h('sam')}[^,]* · hasn’t opened it`))
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

describe("a team's approval requirements", () => {
  test('set by its maintainers, asked of ideas going out for review, and needed to close as accepted', async () => {
    await Promise.all([api(h('lee')).me({}), api(h('kim')).me({})])
    const riley = await repoAs('riley', { 'plan.md': '# Plan\n\nThe quick brown fox.\n' })
    const team = h('payments')
    expect((await riley.ideaf('team', 'create', team, '--name', 'Payments')).exit).toBe(0)
    expect((await riley.ideaf('group', 'create', h('security'), '--name', 'Security')).exit).toBe(0)
    expect((await riley.ideaf('group', 'add', h('security'), h('lee'))).exit).toBe(0)
    expect((await riley.ideaf('team', 'requirements', team)).out).toContain('No approval requirements.')
    const set = await riley.ideaf(
      'team',
      'requirements',
      team,
      '--approvals',
      '2',
      '--rule',
      `each:${h('security')}:request`,
      '--resolved',
    )
    expect(set.exit).toBe(0)
    expect(set.out).toContain('2 approvals from people')
    expect(set.out).toContain(`an approval from each of group:${h('security')} (asked to review when an idea goes out)`)
    expect((await riley.ideaf('team', 'requirements', team, '--rule', 'some:x')).exit).toBe(2)

    // going out for review asks security, which gives lee view access
    const { idea } = (await riley.ideaf('start', '--title', 'Payments plan', '--team', team, '--json')).json()
    await expect(api(h('lee')).getIdea({ idea })).rejects.toMatchObject({ code: 'not_found' })
    expect((await riley.ideaf('status', 'review')).exit).toBe(0)
    expect((await api(h('lee')).getIdea({ idea })).you.view).toBe(true)

    // kim comments; neither approval is there yet
    await riley.ideaf('review', 'ask', h('kim'))
    await api(h('kim')).addComment({ idea, version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Which fox?' })
    let shown = (await riley.ideaf('review', 'show')).out
    expect(shown).toContain('approval requirements aren’t met yet')
    expect(shown).toContain('0 of 2 approvals')
    const blocked = await riley.ideaf('close', '--accepted')
    expect(blocked.exit).toBe(12)
    expect(blocked.err).toContain('0 of 2 approvals')

    // kim and lee (security) approve, and the thread is resolved
    await api(h('kim')).reviewIdea({ idea, version: 1, verdict: 'approve' })
    await api(h('lee')).reviewIdea({ idea, version: 1, verdict: 'approve' })
    expect((await riley.ideaf('close', '--accepted')).err).toContain('1 open thread')
    await api(h('riley')).resolveComment({ idea, comment: 'c1', resolved: true })
    shown = (await riley.ideaf('review', 'show')).out
    expect(shown).toContain('approval requirements are met')
    expect((await riley.ideaf('close', '--accepted')).exit).toBe(0)
  })
})

describe('a pending review', () => {
  test('comments wait, seen only by their author, and go out together with the verdict', async () => {
    await api(h('ana')).me({})
    const riley = await repoAs('riley', { 'plan.md': '# Plan\n\nThe quick brown fox.\n\n## Risks\n\nIt might rain.\n' })
    const { idea } = (await riley.ideaf('start', '--title', 'Pending', '--json')).json()
    expect((await riley.ideaf('review', 'ask', h('ana'))).exit).toBe(0)
    const ana = await repoAs('ana')

    const first = await ana.ideaf(
      'comment',
      'add',
      'Which fox?',
      '--quote',
      'quick brown fox',
      '--idea',
      idea,
      '--pending',
      '--json',
    )
    expect(first.exit).toBe(0)
    expect(first.json()).toMatchObject({ pending: true })
    const suggested = await ana.ideaf(
      'comment',
      'suggest',
      'may pour',
      '--quote',
      'might rain',
      '--idea',
      idea,
      '--pending',
    )
    expect(suggested.out).toContain('It waits for your review')
    expect((await ana.ideaf('comment', 'edit', 'c1', 'Which fox, exactly?', '--idea', idea)).exit).toBe(0)

    // riley sees none of it
    expect(await api(h('riley')).listComments({ idea })).toEqual([])
    expect((await ana.ideaf('comment', 'list', '--idea', idea)).out).toContain('pending: only you see it')
    expect((await ana.ideaf('review', 'show', '--idea', idea)).out).toContain('You have 2 pending comments')

    // one deleted; the other goes out with her verdict
    expect((await ana.ideaf('comment', 'delete', 'c2', '--idea', idea)).out).toContain('Deleted c2.')
    const approved = await ana.ideaf('review', 'request-changes', '--idea', idea, '-m', 'One question')
    expect(approved.out).toContain('publishing 1 pending comment')
    const seen = await api(h('riley')).listComments({ idea })
    expect(seen.map((t) => [t.id, t.body, t.pending])).toEqual([['c1', 'Which fox, exactly?', false]])

    // nothing left to submit; a discarded review sends nothing
    expect((await ana.ideaf('review', 'submit', '--idea', idea)).exit).toBe(2)
    await ana.ideaf('comment', 'add', 'Never mind', '--file', 'plan.md', '--idea', idea, '--pending')
    expect((await ana.ideaf('review', 'discard', '--idea', idea)).out).toContain('Discarded 1 pending comment.')
    expect((await api(h('riley')).listComments({ idea })).length).toBe(1)
  })
})
