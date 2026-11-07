// ideaf list, end to end: this repository's ideas (from their state files) and
// the server's, yours by default.
import { beforeAll, describe, expect, test } from 'bun:test'
import { api, repo, server, token } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`

type Item = { id: string; active: boolean; title?: string; local?: number; latest?: number; missing?: true }

/** An idea maya owns, shared with this person for viewing. */
async function mayasIdea(withWhom: string) {
  await api(withWhom).me({})
  const { idea } = await api(h('maya')).createIdea({
    title: `Maya's plan ${run}`,
    files: [{ path: 'm.md', content: '# M\n' }],
  })
  await api(h('maya')).setAccess({
    idea,
    subject: { kind: 'user', id: withWhom },
    access: { edit: false, share: false },
  })
  return idea
}

describe("ideaf list: this repository's ideas", () => {
  test('yours, the active one first, and others’ with --anyone', async () => {
    const theirs = await mayasIdea(h('riley'))
    const r = await repo({ 'a/plan.md': '# A\n', 'b/plan.md': '# B\n' }, { token: token(h('riley')) })
    expect((await r.ideaf('list')).out).toContain('No ideas in this repository yet')
    const first = (await r.ideaf('start', 'a', '--title', 'First', '--json')).json().idea
    expect((await r.ideaf('pull', '--idea', theirs)).exit).toBe(0)
    const second = (await r.ideaf('start', 'b', '--title', 'Second', '--json')).json().idea

    const mine = await r.ideaf('list', '--json')
    expect(mine.exit).toBe(0)
    expect(mine.json().items.map((i: Item) => [i.id, i.active])).toEqual([
      [second, true],
      [first, false],
    ])
    expect(mine.json().hidden).toBe(1)
    const shown = (await r.ideaf('list')).out
    expect(shown.split('\n')[0]).toMatch(new RegExp(`^\\* +${second} +Second +draft +v1 +@${h('riley')} +on main$`))
    expect(shown).toContain('1 more here is other people’s: --anyone shows it.')
    expect((await r.ideaf('list', '--anyone', '--json')).json().items.map((i: Item) => i.id)).toContain(theirs)
  })

  test('says which are behind the server, and which are gone', async () => {
    const theirs = await mayasIdea(h('sam'))
    const r = await repo({}, { token: token(h('sam')) })
    expect((await r.ideaf('pull', '--idea', theirs)).exit).toBe(0)
    await api(h('maya')).edit({
      idea: theirs,
      batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'More.' }] },
    })
    expect((await r.ideaf('list', '--anyone')).out).toContain('v2 (here v1: pull)')
    await api(h('maya')).setAccess({ idea: theirs, subject: { kind: 'user', id: h('sam') }, access: null })
    expect((await r.ideaf('list', '--json')).json().items).toMatchObject([{ id: theirs, missing: true, local: 1 }])
  })
})

describe('ideaf list --server', () => {
  test('yours by default, everyone’s with --anyone, and by team, owner or search', async () => {
    const word = `walrus${run}`
    await api(h('rowan')).me({})
    const team = await api(h('rowan')).createTeam({ handle: h('core'), name: 'Core' })
    const shared = await api(h('maya')).createIdea({
      title: `Shared ${word}`,
      files: [{ path: 'm.md', content: '# M\n' }],
    })
    await api(h('maya')).setAccess({
      idea: shared.idea,
      subject: { kind: 'user', id: h('rowan') },
      access: { edit: false, share: false },
    })
    const r = await repo({ 'plan.md': '# P\n' }, { token: token(h('rowan')) })
    const here = (await r.ideaf('start', '--title', `Mine ${word}`, '--team', team.handle, '--json')).json().idea

    const mine = await r.ideaf('list', '--server', '--json')
    expect(mine.json().items.map((i: { id: string }) => i.id)).toEqual([here])
    expect(mine.json().items[0]).toMatchObject({ here: true, active: true, team: { id: team.id, handle: team.handle } })
    const shown = await r.ideaf('list', '--server')
    expect(shown.out).toMatch(
      new RegExp(`^\\* +${here} +Mine ${word} +draft +v1 +@${h('rowan')} +team:${h('core')} +just now$`, 'm'),
    )

    const everyone = (await r.ideaf('list', '--server', '--anyone', '--json'))
      .json()
      .items.map((i: { id: string }) => i.id)
    expect(everyone).toEqual(expect.arrayContaining([here, shared.idea]))
    expect(
      (await r.ideaf('list', '--owner', h('maya'), '--json')).json().items.map((i: { id: string }) => i.id),
    ).toEqual([shared.idea])
    expect(
      (await r.ideaf('list', '--team', team.handle, '--json')).json().items.map((i: { id: string }) => i.id),
    ).toEqual([here])
    const found = (await r.ideaf('list', '--search', word, '--json')).json()
    expect(found.items.map((i: { id: string }) => i.id).sort()).toEqual([here, shared.idea].sort())
    expect(found.incomplete).toBe(false)

    expect((await r.ideaf('list', '--search', word, '--team', team.handle)).exit).toBe(2)
    expect((await r.ideaf('list', '--cursor', 'x')).exit).toBe(2)
    expect((await r.ideaf('list', '--search', 'ab')).exit).toBe(2)
  })
})
