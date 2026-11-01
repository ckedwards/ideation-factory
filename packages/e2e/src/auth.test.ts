// The cli signed in for real: a personal token in IDEAF_TOKEN is exchanged for
// a 15-minute access token once per run, and a bad one fails clearly.
import { beforeAll, expect, test } from 'bun:test'
import { personalToken, repo, server } from './harness.ts'

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
