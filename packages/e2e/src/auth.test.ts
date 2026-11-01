// The cli with a personal token in IDEAF_TOKEN (the stopgap for CI), sent as
// is, and a bad or missing one failing clearly.
import { beforeAll, expect, test } from 'bun:test'
import { TEST_URL } from '@ideaf/server/testing.ts'
import { describe } from 'bun:test'
import { api, personalToken, repo, server } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)

test('a personal token works, and a refused or missing one says where to get another', async () => {
  const r = await repo({ 'plan.md': '# Plan\n' }, { token: personalToken(`cli-${run}`) })
  const started = await r.ideaf('start', '--title', 'Signed in', '--json')
  expect(started.exit).toBe(0)
  expect((await r.ideaf('list', '--json')).json().items[0]).toMatchObject({ title: 'Signed in' })

  const refused = await repo({ 'plan.md': '# Plan\n' }, { token: 'ideaf_not-a-token' })
  const bad = await refused.ideaf('list', '--server')
  expect(bad.exit).toBe(6)
  expect(bad.err).toContain('IDEAF_TOKEN was refused')
  expect(bad.err).toContain('/login')

  const none = await repo({ 'plan.md': '# Plan\n' }, { token: null })
  const missing = await none.ideaf('list', '--server')
  expect(missing.exit).toBe(6)
  expect(missing.err).toContain('set IDEAF_TOKEN')
})

describe('ideaf auth', () => {
  const h = (name: string) => `${name}-${run}`

  test('login in the browser, with a bot and a team; status; the tokens work; logout', async () => {
    const riley = h('riley')
    const owner = api(riley)
    const core = await owner.createTeam({ handle: h('core'), name: 'Core' })
    const inCore = (
      await owner.createIdea({ title: 'Core plan', team: core.handle, files: [{ path: 'a.md', content: '# A\n' }] })
    ).idea
    await owner.createIdea({ title: 'Elsewhere', files: [{ path: 'a.md', content: '# A\n' }] })

    const r = await repo({}, { token: null, browser: { as: riley } })
    expect((await r.ideaf('auth', 'status')).exit).toBe(6)
    const login = await r.ideaf('auth', 'login', '--bot', 'planbot', '--team', core.handle)
    expect(login.exit).toBe(0)
    expect(login.out).toContain(
      `Signed in to ${TEST_URL} as @${riley}, as planbot (a bot for you), limited to team:${core.handle}.`,
    )

    const status = await r.ideaf('auth', 'status', '--json')
    expect(status.json()).toMatchObject({ signedIn: true, using: 'memory', bot: 'planbot', readOnly: false })
    // the cli uses the sign-in, with its limits
    expect(
      (await r.ideaf('list', '--server', '--anyone', '--json')).json().items.map((i: { id: string }) => i.id),
    ).toEqual([inCore])
    expect((await r.ideaf('share', '--idea', inCore, 'everyone')).exit).toBe(6)

    expect((await r.ideaf('auth', 'logout')).out).toContain(`Signed out of ${TEST_URL}.`)
    const after = await r.ideaf('list', '--server')
    expect(after.exit).toBe(6)
    expect(after.err).toContain('ideaf auth login')
  })

  test('without a browser here: open the link elsewhere and paste the code', async () => {
    const r = await repo({}, { token: null, browser: { as: h('maya'), mode: 'remote' }, answers: [] })
    const login = await r.ideaf('auth', 'login', '--read-only')
    expect(login.exit).toBe(0)
    expect(login.out).toContain('Open this link on any device')
    expect(login.out).toContain(`as @${h('maya')}, read only.`)
    expect((await r.ideaf('list', '--server', '--json')).exit).toBe(0)
    // and not at all without a person to paste it
    const agent = await repo({}, { token: null })
    expect((await agent.ideaf('auth', 'login', '--no-browser')).exit).toBe(2)
  })
})
